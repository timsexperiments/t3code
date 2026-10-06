import { useId, useState } from "react";
import { Pressable, View } from "react-native";
import { EnvironmentImage } from "../../components/EnvironmentImage";

import { FilePreviewLoading } from "./FilePreviewFeedback";
import { EmptyState } from "../../components/EmptyState";
import { FilePreviewModal, type FilePreviewSource } from "../../components/FilePreviewModal";
import { PresentationSource } from "../../components/NativePresentation";
import { useMediaActions, type MediaActionsSource } from "../../lib/mediaActions";
import { MediaActionsMenu } from "../../components/MediaActionsMenu";

function ResolvedWorkspaceFileImagePreview(props: {
  readonly accessibilityLabel: string;
  readonly uri: string;
  readonly actionsSource?: MediaActionsSource;
}) {
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preview, setPreview] = useState<FilePreviewSource | null>(null);
  const sourceIdentifier = useId();
  const mediaActions = useMediaActions(props.actionsSource);

  return (
    <View className="relative flex-1 bg-subtle">
      <MediaActionsMenu media={mediaActions} style={{ flex: 1 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open full-screen preview of ${props.accessibilityLabel}`}
          accessibilityHint={
            mediaActions.actions.length > 0 ? "Touch and hold for media actions" : undefined
          }
          disabled={loadError !== null}
          className="flex-1 p-4 active:bg-subtle-strong"
          onPress={() =>
            setPreview({
              kind: "image",
              uri: props.uri,
              name: props.accessibilityLabel,
              sourceIdentifier,
              actionsSource: props.actionsSource,
            })
          }
        >
          <PresentationSource identifier={sourceIdentifier} style={{ flex: 1 }}>
            <EnvironmentImage
              accessible={false}
              uri={props.uri}
              onTransportError={() => setLoadError("The image could not be loaded.")}
              className="h-full w-full"
              resizeMode="contain"
              onLoadStart={() => setLoadError(null)}
              onError={(event) => {
                setLoadError(event.nativeEvent.error || "The image could not be rendered.");
              }}
            />
          </PresentationSource>
        </Pressable>
      </MediaActionsMenu>
      {loadError !== null ? (
        <View
          pointerEvents="none"
          className="absolute inset-0 items-center justify-center bg-card px-6"
        >
          <EmptyState title="Image unavailable" detail={loadError} />
        </View>
      ) : null}
      <FilePreviewModal source={preview} onRequestClose={() => setPreview(null)} />
    </View>
  );
}

export function WorkspaceFileImagePreview(props: {
  readonly accessibilityLabel: string;
  readonly uri: string | null;
  readonly actionsSource?: MediaActionsSource;
}) {
  if (props.uri === null) {
    return <FilePreviewLoading message="Preparing image preview..." background="card" />;
  }

  return (
    <ResolvedWorkspaceFileImagePreview
      accessibilityLabel={props.accessibilityLabel}
      uri={props.uri}
      actionsSource={props.actionsSource}
    />
  );
}
