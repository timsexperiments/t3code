import { useEffect, useState } from "react";

import { serviceAuthForUrl } from "../persistence/environment-service-auth";
import type { AttachmentPreviewFile } from "./attachmentDownload";

type MediaFile = AttachmentPreviewFile;
type MediaEntry = {
  readonly auth: NonNullable<ReturnType<typeof serviceAuthForUrl>>;
  readonly controller: AbortController;
  readonly promise: Promise<MediaFile | null>;
  references: number;
  file: MediaFile | null;
  bytes: number;
};
const mediaCache = new Map<string, MediaEntry>();
const MAX_CACHE_BYTES = 80 * 1024 * 1024;
const MAX_CACHE_FILES = 16;

function trimMediaCache() {
  let bytes = [...mediaCache.values()].reduce((sum, entry) => sum + entry.bytes, 0);
  for (const [key, entry] of mediaCache) {
    if (bytes <= MAX_CACHE_BYTES && mediaCache.size <= MAX_CACHE_FILES) break;
    if (entry.references !== 0 || !entry.file) continue;
    mediaCache.delete(key);
    bytes -= entry.bytes;
    entry.file.dispose();
  }
}

// Native media APIs cannot restrict credential forwarding on redirects.
export async function acquireEnvironmentMedia(uri: string, signal: AbortSignal) {
  if (signal.aborted) return null;
  const auth = serviceAuthForUrl(uri);
  if (auth === null) return { uri, dispose: () => undefined };
  let entry = mediaCache.get(uri);
  if (entry?.auth !== auth) {
    if (entry?.references === 0) {
      entry.controller.abort();
      entry.file?.dispose();
    }
    const controller = new AbortController();
    const name = new URL(uri).pathname.split("/").at(-1) || "Preview";
    const next: MediaEntry = {
      auth,
      controller,
      references: 0,
      file: null,
      bytes: 0,
      promise: Promise.resolve()
        .then(async () => {
          const { downloadAttachmentForPreview } = await import("./attachmentDownload");
          const file = await downloadAttachmentForPreview({
            url: uri,
            attachment: { name, mimeType: "application/octet-stream" },
            signal: controller.signal,
          });
          if (!file) return null;
          const { File } = await import("expo-file-system");
          next.file = file;
          next.bytes = new File(file.uri).size;
          trimMediaCache();
          return file;
        })
        .catch((cause: unknown) => {
          if (mediaCache.get(uri) === next) mediaCache.delete(uri);
          throw cause;
        }),
    };
    entry = next;
  }
  mediaCache.delete(uri);
  mediaCache.set(uri, entry);
  const current = entry;
  current.references += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    current.references -= 1;
    if (current.references === 0) {
      if (!current.file) {
        current.controller.abort();
        if (mediaCache.get(uri) === current) mediaCache.delete(uri);
      } else if (mediaCache.get(uri) !== current) current.file.dispose();
      trimMediaCache();
    }
  };
  signal.addEventListener("abort", release, { once: true });
  try {
    const file = await current.promise;
    if (!file || signal.aborted) {
      release();
      return null;
    }
    return {
      uri: file.uri,
      dispose: () => {
        signal.removeEventListener("abort", release);
        release();
      },
    };
  } catch (cause) {
    release();
    throw cause;
  } finally {
    if (released) signal.removeEventListener("abort", release);
  }
}

export function useEnvironmentMediaUri(uri: string | null) {
  const auth = uri === null ? null : serviceAuthForUrl(uri);
  const [resolved, setResolved] = useState<{
    readonly source: string;
    readonly auth: typeof auth;
    readonly uri: string | null;
    readonly error: Error | null;
  } | null>(null);
  useEffect(() => {
    if (uri === null || auth === null) return;
    const controller = new AbortController();
    let release: (() => void) | undefined;
    void acquireEnvironmentMedia(uri, controller.signal)
      .then((file) => {
        if (!file) return;
        if (controller.signal.aborted) return file.dispose();
        release = file.dispose;
        setResolved({ source: uri, auth, uri: file.uri, error: null });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setResolved({
            source: uri,
            auth,
            uri: null,
            error: cause instanceof Error ? cause : new Error("Could not load this file."),
          });
      });
    return () => {
      controller.abort();
      release?.();
    };
  }, [uri, auth]);
  if (auth === null) return { uri, error: null };
  return resolved?.source === uri && resolved.auth === auth
    ? { uri: resolved.uri, error: resolved.error }
    : { uri: null, error: null };
}
