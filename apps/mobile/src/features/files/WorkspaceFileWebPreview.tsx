import type { EnvironmentId } from "@t3tools/contracts";
import { HtmlRenderWebView } from "../threads/HtmlRenderWebView";
import { environmentMediaSource } from "../../lib/environment-network";
import { useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { WebView } from "react-native-webview";

import { AppText as Text } from "../../components/AppText";
import { FilePreviewLoading } from "./FilePreviewFeedback";
import { LoadingStrip } from "../../components/LoadingStrip";

export function WorkspaceFileWebPreview(props: {
  readonly environmentId: EnvironmentId;
  readonly uri: string | null;
}) {
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  if (props.uri === null) {
    return <FilePreviewLoading message="Preparing preview..." background="card" />;
  }

  if (/\.html?(?:$|[?#])/i.test(props.uri)) {
    return (
      <HtmlRenderWebView
        environmentId={props.environmentId}
        uri={props.uri}
        title="File preview"
        nested={false}
      />
    );
  }

  return (
    <View className="relative flex-1 bg-card">
      {loadProgress > 0 && loadProgress < 1 ? <LoadingStrip progress={loadProgress} /> : null}
      {loadError ? (
        <View className="border-b border-border bg-card px-4 py-2">
          <Text className="text-xs font-t3-bold text-foreground">Preview failed</Text>
          <Text className="mt-0.5 text-xs leading-snug text-foreground-muted">{loadError}</Text>
        </View>
      ) : null}
      <WebView
        source={environmentMediaSource(props.uri)}
        originWhitelist={["*"]}
        allowsBackForwardNavigationGestures
        allowsFullscreenVideo
        setSupportMultipleWindows={false}
        startInLoadingState
        onLoadProgress={(event) => {
          setLoadProgress(event.nativeEvent.progress);
        }}
        onLoadStart={() => {
          setLoadProgress(0.05);
          setLoadError(null);
        }}
        onLoadEnd={() => {
          setLoadProgress(0);
        }}
        onError={(event) => {
          setLoadProgress(0);
          setLoadError(event.nativeEvent.description || "The file could not be rendered.");
        }}
        renderLoading={() => (
          <View className="absolute inset-0 items-center justify-center bg-card">
            <ActivityIndicator />
          </View>
        )}
        style={{ flex: 1, backgroundColor: "transparent" }}
      />
    </View>
  );
}
