import { fetch as expoFetch } from "expo/fetch";
import { requireNativeModule } from "expo";
import type { File } from "expo-file-system";

import { serviceAuthHeadersForUrl } from "../persistence/environment-service-auth";
import {
  makeEnvironmentServiceAuthWebSocketConstructor,
  withEnvironmentServiceAuth,
} from "./service-auth-transport";

// Expo fetch implements redirect modes on both native platforms; RN's fetch does not.
export const environmentFetch = withEnvironmentServiceAuth(expoFetch);

function nativeControlsModule() {
  return requireNativeModule<{
    configureEnvironmentWebSocket(): void;
  }>("T3NativeControls");
}

export function makeEnvironmentWebSocketConstructor() {
  return makeEnvironmentServiceAuthWebSocketConstructor((url) => {
    const headers = serviceAuthHeadersForUrl(url);
    if (headers !== null) nativeControlsModule().configureEnvironmentWebSocket();
    return headers;
  });
}

export async function uploadEnvironmentFile(input: {
  readonly file: File;
  readonly url: string;
  readonly contentType: string;
  readonly signal: AbortSignal;
  readonly onProgress?: (progress: number) => void;
}) {
  if (input.signal.aborted) throw new Error("Upload cancelled.");
  const headers = serviceAuthHeadersForUrl(input.url);
  return input.file.upload(input.url, {
    httpMethod: "POST",
    uploadType: 0,
    headers: { ...headers, "Content-Type": input.contentType },
    ...(headers === null ? {} : { followRedirects: false }),
    signal: input.signal,
    onProgress: ({ bytesSent, totalBytes }) => {
      if (totalBytes > 0) input.onProgress?.(bytesSent / totalBytes);
    },
  });
}

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
