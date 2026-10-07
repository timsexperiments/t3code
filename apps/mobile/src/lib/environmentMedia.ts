import { useEffect, useState } from "react";

import { serviceAuthForUrl } from "../persistence/environment-service-auth";

export async function acquireEnvironmentMedia(uri: string, signal: AbortSignal) {
  if (signal.aborted) return null;
  if (serviceAuthForUrl(uri) === null) return { uri, dispose: () => undefined };
  const { downloadAttachmentForPreview } = await import("./attachmentDownload");
  return downloadAttachmentForPreview({
    url: uri,
    attachment: {
      name: new URL(uri).pathname.split("/").at(-1) || "Preview",
      mimeType: "application/octet-stream",
    },
    signal,
  });
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
