import { fetch as expoFetch } from "expo/fetch";
import { requireNativeModule } from "expo";
import type { File } from "expo-file-system";

import { serviceAuthHeadersForUrl } from "../persistence/environment-service-auth";
import {
  makeEnvironmentServiceAuthWebSocketConstructor,
  withEnvironmentServiceAuth,
} from "./service-auth-transport";
import { uuidv4 } from "./uuid";

// Expo fetch implements redirect modes on both native platforms; RN's fetch does not.
export const environmentFetch = withEnvironmentServiceAuth(expoFetch);

type TransferProgress = { readonly id: string; readonly sent: number; readonly total: number };
type TransferResult = { readonly status: number };

function transferModule() {
  return requireNativeModule<{
    configureEnvironmentWebSocket(): void;
    uploadEnvironmentFile(
      id: string,
      url: string,
      fileUri: string,
      headers: Record<string, string>,
    ): Promise<TransferResult>;
    cancelEnvironmentTransfer(id: string): void;
    addListener(
      event: "environmentTransferProgress",
      listener: (event: TransferProgress) => void,
    ): { remove(): void };
  }>("T3NativeControls");
}

/** Initialize the native socket policy before handing credentials to RN's WebSocket. */
export function makeEnvironmentWebSocketConstructor() {
  return makeEnvironmentServiceAuthWebSocketConstructor((url) => {
    const headers = serviceAuthHeadersForUrl(url);
    if (headers !== null) transferModule().configureEnvironmentWebSocket();
    return headers;
  });
}

/** Stream from disk with native progress and cancellation; never follow credentialed redirects. */
export async function uploadEnvironmentFile(input: {
  readonly file: File;
  readonly url: string;
  readonly contentType: string;
  readonly signal: AbortSignal;
  readonly onProgress?: (progress: number) => void;
}): Promise<TransferResult> {
  if (input.signal.aborted) throw new Error("Upload cancelled.");
  const headers = serviceAuthHeadersForUrl(input.url);
  if (headers === null) {
    return input.file.upload(input.url, {
      httpMethod: "POST",
      uploadType: 0,
      headers: { "Content-Type": input.contentType },
      signal: input.signal,
      onProgress: ({ bytesSent, totalBytes }) => {
        if (totalBytes > 0) input.onProgress?.(bytesSent / totalBytes);
      },
    });
  }
  const native = transferModule();
  const id = uuidv4();
  const subscription = native.addListener("environmentTransferProgress", (event) => {
    if (event.id === id && event.total > 0) input.onProgress?.(event.sent / event.total);
  });
  const abort = () => native.cancelEnvironmentTransfer(id);
  input.signal.addEventListener("abort", abort, { once: true });
  try {
    return await native.uploadEnvironmentFile(id, input.url, input.file.uri, {
      ...headers,
      "Content-Type": input.contentType,
    });
  } finally {
    input.signal.removeEventListener("abort", abort);
    subscription.remove();
  }
}

/** Authenticated downloads stream to disk, retaining the existing cache's ownership rules. */
export async function downloadEnvironmentFile(url: string, file: File, signal: AbortSignal) {
  if (serviceAuthHeadersForUrl(url) === null) {
    const { File } = await import("expo-file-system");
    await File.downloadFileAsync(url, file, { signal });
    return;
  }
  const response = await environmentFetch(url, { signal });
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}).`);
  file.create({ overwrite: true });
  await response.body.pipeTo(file.writableStream(), { signal });
}
