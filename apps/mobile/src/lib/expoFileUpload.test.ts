import { beforeEach, expect, it, vi } from "vite-plus/test";

const native = vi.hoisted(() => ({
  start: vi.fn(),
  cancel: vi.fn(),
  listener: vi.fn(),
  removeListener: vi.fn(),
}));
vi.mock("../../node_modules/expo-file-system/build/Directory", () => ({ Directory: vi.fn() }));
vi.mock("../../node_modules/expo-file-system/build/File", () => ({
  File: class {
    exists = false;
  },
}));
vi.mock("../../node_modules/expo-file-system/build/ExpoFileSystem", () => ({
  default: {
    FileSystemUploadTask: class {
      start = native.start;
      cancel = native.cancel;
      addListener = native.listener;
    },
  },
}));

import { File } from "../../node_modules/expo-file-system/build/File";
import { UploadTask } from "../../node_modules/expo-file-system/build/NetworkTasks";

beforeEach(() => {
  vi.clearAllMocks();
  native.listener.mockReturnValue({ remove: native.removeListener });
});

it.each([undefined, false, true])(
  "passes redirect policy %s through Expo's upload bridge",
  async (followRedirects) => {
    native.start.mockResolvedValue({ status: 204, body: "", headers: {} });
    const upload = new UploadTask(new File("file:///upload"), "https://example.test/upload", {
      followRedirects,
    });
    await upload.uploadAsync();
    expect(native.start.mock.calls[0]?.[2].followRedirects).toBe(followRedirects ?? true);
  },
);

it("retains Expo progress events and cancellation with redirects disabled", async () => {
  const done = Promise.withResolvers<{
    status: number;
    body: string;
    headers: Record<string, string>;
  }>();
  native.start.mockReturnValue(done.promise);
  const controller = new AbortController();
  const progress = vi.fn();
  const upload = new UploadTask(new File("file:///upload"), "https://example.test/upload", {
    followRedirects: false,
    signal: controller.signal,
    onProgress: progress,
  });
  const pending = upload.uploadAsync();
  native.listener.mock.calls[0]?.[1]({ bytesSent: 5, totalBytes: 10 });
  expect(progress).toHaveBeenCalledWith({ bytesSent: 5, totalBytes: 10 });
  controller.abort();
  expect(native.cancel).toHaveBeenCalledTimes(1);
  done.reject(new Error("Upload cancelled"));
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(native.removeListener).toHaveBeenCalledTimes(1);
});
