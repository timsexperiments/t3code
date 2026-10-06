import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
const mocks = vi.hoisted(() => ({ download: vi.fn(), dispose: vi.fn(), size: 3 }));
vi.mock("./attachmentDownload", () => ({ downloadAttachmentForPreview: mocks.download }));
vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItem: () => null,
  setItemAsync: async () => undefined,
}));
vi.mock("expo-file-system", () => ({
  File: class {
    get size() {
      return mocks.size;
    }
  },
}));
import { acquireEnvironmentMedia } from "./environmentMedia";
import {
  clearServiceAuthDocumentForTests,
  makeCustomHeadersServiceAuth,
  setServiceAuthForUrl,
} from "../persistence/environment-service-auth";

beforeEach(() => {
  clearServiceAuthDocumentForTests();
  vi.clearAllMocks();
  mocks.size = 3;
});
async function credentials(url: string, value = "synthetic") {
  await setServiceAuthForUrl(
    url,
    makeCustomHeadersServiceAuth([{ name: "X-Service-Token", value }]),
  );
}
describe("protected native media", () => {
  it("leaves local files and unrelated origins on their existing paths", async () => {
    await credentials("https://protected.example");
    for (const uri of ["file:///photo.png", "https://public.example/photo.png"]) {
      const media = await acquireEnvironmentMedia(uri, new AbortController().signal);
      expect(media?.uri).toBe(uri);
      media?.dispose();
    }
    expect(mocks.download).not.toHaveBeenCalled();
  });
  it("shares a download without allowing one viewer's cancellation to cancel another", async () => {
    const url = "https://protected.example/shared.png";
    await credentials(url);
    const started = Promise.withResolvers<void>();
    const download = Promise.withResolvers<{ uri: string; dispose: () => void }>();
    let transferSignal: AbortSignal | undefined;
    mocks.download.mockImplementation((input: { signal: AbortSignal }) => {
      transferSignal = input.signal;
      started.resolve();
      return download.promise;
    });
    const first = new AbortController();
    const second = new AbortController();
    const a = acquireEnvironmentMedia(url, first.signal);
    const b = acquireEnvironmentMedia(url, second.signal);
    await started.promise;
    first.abort();
    expect(transferSignal?.aborted).toBe(false);
    download.resolve({ uri: "file:///shared.png", dispose: mocks.dispose });
    expect(await a).toBeNull();
    const result = await b;
    expect(result?.uri).toBe("file:///shared.png");
    result?.dispose();
    const cached = await acquireEnvironmentMedia(url, new AbortController().signal);
    expect(cached?.uri).toBe("file:///shared.png");
    cached?.dispose();
    expect(mocks.download).toHaveBeenCalledTimes(1);
  });
  it("reauthorizes a cached file after service credentials change", async () => {
    const url = "https://protected.example/rotated.png";
    await credentials(url);
    mocks.download.mockResolvedValue({ uri: "file:///first.png", dispose: mocks.dispose });
    const first = await acquireEnvironmentMedia(url, new AbortController().signal);
    first?.dispose();
    await credentials(url, "replacement");
    mocks.download.mockResolvedValue({ uri: "file:///replacement.png", dispose: mocks.dispose });
    const next = await acquireEnvironmentMedia(url, new AbortController().signal);
    expect(next?.uri).toBe("file:///replacement.png");
    next?.dispose();
    expect(mocks.download).toHaveBeenCalledTimes(2);
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
  });
  it("releases large cached files after their last viewer closes", async () => {
    const url = "https://protected.example/large.mp4";
    await credentials(url);
    mocks.size = 100 * 1024 * 1024;
    const dispose = vi.fn();
    mocks.download.mockResolvedValue({ uri: "file:///large.mp4", dispose });
    const media = await acquireEnvironmentMedia(url, new AbortController().signal);
    expect(dispose).not.toHaveBeenCalled();
    media?.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
  it("retries failed downloads instead of caching a failed result", async () => {
    const url = "https://protected.example/retry.png";
    await credentials(url);
    mocks.download.mockRejectedValueOnce(new Error("403"));
    await expect(acquireEnvironmentMedia(url, new AbortController().signal)).rejects.toThrow("403");
    mocks.download.mockResolvedValue({ uri: "file:///retry.png", dispose: mocks.dispose });
    const media = await acquireEnvironmentMedia(url, new AbortController().signal);
    expect(media?.uri).toBe("file:///retry.png");
    media?.dispose();
    expect(mocks.download).toHaveBeenCalledTimes(2);
  });
});
