import { useEffect, useEffectEvent } from "react";
import { Alert, Modal, Pressable, View } from "react-native";
import ImageViewing from "react-native-image-viewing";

import { openAttachmentInViewer } from "../lib/attachmentDownload";
import type { ResolvedFilePreviewSource } from "./FilePreviewModal.types";
import { MediaImagePreview } from "./MediaImagePreview";
import { AppText as Text } from "./AppText";
import { useEnvironmentMediaUri } from "../lib/environmentMedia";
import { ActivityIndicator } from "react-native";

function DocumentPreview(props: {
  readonly source: ResolvedFilePreviewSource;
  readonly onRequestClose: () => void;
  readonly onOpenError?: (error: unknown) => void;
}) {
  const { uri, name } = props.source;
  const onRequestClose = useEffectEvent(props.onRequestClose);
  const onOpenError = useEffectEvent((error: unknown) => {
    if (props.onOpenError) props.onOpenError(error);
    else
      Alert.alert(
        "Could not open document",
        "A compatible viewer must be installed. Check your connection and try again.",
      );
  });
  useEffect(() => {
    const controller = new AbortController();
    const input = {
      uri,
      attachment: {
        name: name ?? "Document",
        mimeType:
          props.source.mimeType ??
          (props.source.kind === "pdf" ? "application/pdf" : "application/octet-stream"),
      },
      signal: controller.signal,
    };
    const opened = openAttachmentInViewer(input);
    void opened
      .catch((error: unknown) => {
        if (!controller.signal.aborted) onOpenError(error);
      })
      .finally(() => {
        if (!controller.signal.aborted) onRequestClose();
      });
    return () => controller.abort();
  }, [uri, name, props.source.mimeType, props.source.kind]);
  return (
    <Modal transparent animationType="fade" onRequestClose={props.onRequestClose}>
      <View className="flex-1 items-center justify-center bg-backdrop p-6">
        <View className="w-full max-w-sm gap-4 rounded-2xl bg-sheet-solid p-6">
          <Text className="font-t3-semibold text-foreground">Opening document…</Text>
          <Text className="text-foreground-muted" numberOfLines={2}>
            {name ?? "Document"}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={props.onRequestClose}
            className="self-end p-3"
          >
            <Text className="text-foreground">Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export function FilePreview(props: {
  readonly source: ResolvedFilePreviewSource;
  readonly onRequestClose: () => void;
  readonly onOpenError?: (error: unknown) => void;
}) {
  const media = useEnvironmentMediaUri(props.source.kind === "image" ? props.source.uri : null);
  if (props.source.kind !== "image") return <DocumentPreview {...props} />;
  if (media.uri === null)
    return (
      <Modal transparent onRequestClose={props.onRequestClose}>
        <View className="flex-1 items-center justify-center bg-backdrop">
          <ActivityIndicator />
          <Text>{media.error?.message ?? "Loading image…"}</Text>
          <Pressable onPress={props.onRequestClose}>
            <Text>Close</Text>
          </Pressable>
        </View>
      </Modal>
    );
  if (props.source.actionsSource)
    return <MediaImagePreview {...props} source={{ ...props.source, uri: media.uri }} />;
  return (
    <ImageViewing
      images={[{ uri: media.uri }]}
      imageIndex={0}
      visible
      onRequestClose={props.onRequestClose}
      swipeToCloseEnabled
      doubleTapToZoomEnabled
    />
  );
}
