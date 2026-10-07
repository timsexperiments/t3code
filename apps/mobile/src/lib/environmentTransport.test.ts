import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn<typeof fetch>(),
  configureSocket: vi.fn(),
  upload: vi.fn(),
  download: vi.fn(),
  create: vi.fn(),
  written: new Array<number[]>(),
}));
vi.mock("expo/fetch", () => ({ fetch: mocks.fetch }));
vi.mock("expo", () => ({
  requireNativeModule: () => ({
    configureEnvironmentWebSocket: mocks.configureSocket,
  }),
}));
vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItem: () => null,
  setItemAsync: async () => undefined,
}));
vi.mock("expo-file-system", () => ({
  File: class {
    static downloadFileAsync = mocks.download;
    constructor(readonly uri: string) {}
    upload = mocks.upload;
    create = mocks.create;
    writableStream() {
      return new WritableStream<Uint8Array>({
        write: (chunk) => {
          mocks.written.push(Array.from(chunk));
        },
      });
    }
  },
}));

import { File } from "expo-file-system";
import {
  downloadEnvironmentFile,
  environmentFetch,
  makeEnvironmentWebSocketConstructor,
  uploadEnvironmentFile,
} from "./environmentTransport";
import {
  clearServiceAuthDocumentForTests,
  makeCustomHeadersServiceAuth,
  setServiceAuthForUrl,
} from "../persistence/environment-service-auth";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.written = [];
  clearServiceAuthDocumentForTests();
});
const protectedUrl = "https://protected.example/file";
async function credentials() {
  await setServiceAuthForUrl(
    protectedUrl,
    makeCustomHeadersServiceAuth([{ name: "X-Service-Token", value: "synthetic-token" }]),
  );
}

describe("environment transport", () => {
  it("installs the native redirect policy before opening a credentialed socket", async () => {
    await credentials();
    const opened = vi.fn();
    vi.stubGlobal(
      "WebSocket",
      // oxlint-disable-next-line no-extraneous-class -- Native WebSocket is a constructor.
      class {
        constructor(url: string, _protocols: unknown, options: unknown) {
          opened(url, options, mocks.configureSocket.mock.calls.length);
        }
      },
    );
    try {
      const connect = makeEnvironmentWebSocketConstructor();
      connect("wss://other.example/ws");
      connect("wss://protected.example/ws");
      expect(opened.mock.calls).toEqual([
        ["wss://other.example/ws", undefined, 0],
        ["wss://protected.example/ws", { headers: { "X-Service-Token": "synthetic-token" } }, 1],
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("streams authenticated downloads to disk with redirect following disabled", async () => {
    await credentials();
    mocks.fetch.mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
    const signal = new AbortController().signal;
    await downloadEnvironmentFile(protectedUrl, new File("file:///preview"), signal);
    expect(mocks.written.flat()).toEqual([1, 2, 3]);
    const [, init] = mocks.fetch.mock.calls[0]!;
    expect(init?.redirect).toBe("manual");
    expect(new Headers(init?.headers).get("X-Service-Token")).toBe("synthetic-token");
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("does not store a redirect or error page as a successful download", async () => {
    await credentials();
    mocks.fetch.mockResolvedValue(
      new Response("redirect", { status: 302, headers: { Location: "https://other.example" } }),
    );
    await expect(
      downloadEnvironmentFile(
        protectedUrl,
        new File("file:///preview"),
        new AbortController().signal,
      ),
    ).rejects.toThrow("302");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.written).toEqual([]);
  });

  it("preserves ordinary request headers while keeping other origins uncredentialed", async () => {
    await credentials();
    mocks.fetch.mockResolvedValue(new Response("ok"));
    await environmentFetch(protectedUrl, { headers: { Range: "bytes=0-99" } });
    const headers = new Headers(mocks.fetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get("Range")).toBe("bytes=0-99");
    await environmentFetch("https://other.example/file");
    expect(mocks.fetch.mock.calls[1]?.[1]).toBeUndefined();
  });

  it("keeps Expo upload progress and cancellation while refusing authenticated redirects", async () => {
    await credentials();
    mocks.upload.mockResolvedValue({ status: 204 });
    const progress = vi.fn();
    const signal = new AbortController().signal;
    await uploadEnvironmentFile({
      file: new File("file:///upload"),
      url: protectedUrl,
      contentType: "image/png",
      signal,
      onProgress: progress,
    });
    const [url, options] = mocks.upload.mock.calls[0]!;
    expect(url).toBe(protectedUrl);
    expect(options).toMatchObject({
      followRedirects: false,
      signal,
      headers: { "X-Service-Token": "synthetic-token", "Content-Type": "image/png" },
    });
    options.onProgress({ bytesSent: 1, totalBytes: 2 });
    options.onProgress({ bytesSent: 1, totalBytes: 0 });
    expect(progress.mock.calls).toEqual([[0.5]]);
  });

  it("retains the default redirect behavior for uncredentialed uploads", async () => {
    await credentials();
    await uploadEnvironmentFile({
      file: new File("file:///upload"),
      url: "https://other.example/upload",
      contentType: "image/png",
      signal: new AbortController().signal,
    });
    const options = mocks.upload.mock.calls[0]?.[1];
    expect(options.headers).toEqual({ "Content-Type": "image/png" });
    expect(options).not.toHaveProperty("followRedirects");
  });

  it("does not start canceled transfers", async () => {
    await credentials();
    const controller = new AbortController();
    controller.abort();
    await expect(
      uploadEnvironmentFile({
        file: new File("file:///upload"),
        url: protectedUrl,
        contentType: "image/png",
        signal: controller.signal,
      }),
    ).rejects.toThrow("cancelled");
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("keeps ordinary file downloads on the existing native path", async () => {
    await credentials();
    const file = new File("file:///preview");
    const signal = new AbortController().signal;
    await downloadEnvironmentFile("https://other.example/file", file, signal);
    expect(mocks.download).toHaveBeenCalledWith("https://other.example/file", file, { signal });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
