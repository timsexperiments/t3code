import { requireNativeModule } from "expo";
import { useEffect, useEffectEvent, useId } from "react";
import { Alert } from "react-native";

import type { ResolvedFilePreviewSource } from "./FilePreviewModal.types";
import { acquireEnvironmentMedia } from "../lib/environmentMedia";

const NativeControls = requireNativeModule<{
  presentFile(
    uri: string,
    name: string,
    sourceIdentifier: string,
    identifier: string,
  ): Promise<void>;
  dismissFile(identifier: string): Promise<void>;
}>("T3NativeControls");

function NativeFilePreview(props: {
  readonly source: ResolvedFilePreviewSource;
  readonly onRequestClose: () => void;
  readonly onOpenError?: (error: unknown) => void;
}) {
  const { uri, name, sourceIdentifier } = props.source;
  const identifier = useId();
  const onRequestClose = useEffectEvent(props.onRequestClose);
  const onOpenError = useEffectEvent((error: unknown) => {
    if (props.onOpenError) props.onOpenError(error);
    else Alert.alert("Could not open preview", "The file could not be loaded. Please try again.");
  });

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const file = await acquireEnvironmentMedia(uri, controller.signal);
      if (!file) return;
      try {
        if (!controller.signal.aborted)
          await NativeControls.presentFile(
            file.uri,
            name ?? "Preview",
            sourceIdentifier ?? "",
            identifier,
          );
      } finally {
        file.dispose();
      }
    })()
      .catch((error: unknown) => {
        if (!controller.signal.aborted) onOpenError(error);
      })
      .finally(() => {
        if (!controller.signal.aborted) onRequestClose();
      });
    return () => {
      controller.abort();
      void NativeControls.dismissFile(identifier).catch(() => undefined);
    };
  }, [uri, name, sourceIdentifier, identifier]);

  return null;
}

export function FilePreview(props: {
  readonly source: ResolvedFilePreviewSource;
  readonly onRequestClose: () => void;
  readonly onOpenError?: (error: unknown) => void;
}) {
  return <NativeFilePreview {...props} />;
}
