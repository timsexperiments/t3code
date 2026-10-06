import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn<typeof fetch>(),
  configureSocket: vi.fn(),
  nativeUpload: vi.fn(),
  cancel: vi.fn(),
  listener: vi.fn(),
  removeListener: vi.fn(),
  upload: vi.fn(),
  download: vi.fn(),
  create: vi.fn(),
  written: new Array<number[]>(),
}));
vi.mock("expo/fetch", () => ({ fetch: mocks.fetch }));
vi.mock("expo", () => ({
  requireNativeModule: () => ({
    configureEnvironmentWebSocket: mocks.configureSocket,
    uploadEnvironmentFile: mocks.nativeUpload,
    cancelEnvironmentTransfer: mocks.cancel,
    addListener: mocks.listener,
  }),
}));
vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItem: () => null,
  setItemAsync: async () => undefined,
}));
vi.mock("./uuid", () => ({ uuidv4: () => "transfer-id" }));
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
  mocks.listener.mockReturnValue({ remove: mocks.removeListener });
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

  it("uses the guarded native uploader and forwards progress only for its transfer", async () => {
    await credentials();
    const progress = vi.fn();
    const done = Promise.withResolvers<{ status: number }>();
    mocks.nativeUpload.mockReturnValue(done.promise);
    const controller = new AbortController();
    const uploading = uploadEnvironmentFile({
      file: new File("file:///upload"),
      url: protectedUrl,
      contentType: "image/png",
      signal: controller.signal,
      onProgress: progress,
    });
    const listener = mocks.listener.mock.calls[0]?.[1];
    listener({ id: "other", sent: 1, total: 2 });
    listener({ id: "transfer-id", sent: 1, total: 2 });
    expect(progress.mock.calls).toEqual([[0.5]]);
    controller.abort();
    expect(mocks.cancel).toHaveBeenCalledWith("transfer-id");
    done.resolve({ status: 204 });
    await uploading;
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.removeListener).toHaveBeenCalledTimes(1);
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
    expect(mocks.nativeUpload).not.toHaveBeenCalled();
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
