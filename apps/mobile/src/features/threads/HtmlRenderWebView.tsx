import { useNavigation, useIsFocused } from "@react-navigation/native";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import {
  htmlRenderFileName,
  htmlRenderFrameHeight,
  htmlRenderThemeFragment,
  htmlRenderThemeMessage,
  readHtmlRenderLinkRequest,
  htmlRenderResult,
  type HtmlRenderReference,
} from "@t3tools/shared/htmlRender";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, View, type ColorValue } from "react-native";
import { PreviewStreamWebView, type PreviewStreamRef } from "../browser/PreviewStreamWebView";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { mobileHtmlRenderTheme } from "../../lib/htmlRenderTheme";
import { useAssetUrlState, useRefreshAssetUrl } from "../../state/assets";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";

const ROW_BOTTOM_MARGIN = 8;
const FULL_SCREEN_GUTTER = 16;

/** A render row is its frame's height plus spacing; the page's content never sizes it. */
export function htmlRenderRowHeight(frameHeight: number) {
  return frameHeight + ROW_BOTTOM_MARGIN;
}

function useHtmlRenderTheme() {
  const { themeId, themeAppearance, themeVariables, systemColorsActive } =
    useAppearancePreferences();
  return useMemo(
    () =>
      mobileHtmlRenderTheme({
        themeId,
        appearance: themeAppearance,
        variables: themeVariables,
        systemColors: systemColorsActive,
        platform: Platform.OS,
      }),
    [themeId, themeAppearance, themeVariables, systemColorsActive],
  );
}

/** A captured page rendered by its environment's browser. */
export function HtmlRenderWebView(props: {
  readonly environmentId: EnvironmentId;
  readonly uri: string;
  readonly title: string;
  readonly nested: boolean;
  readonly onLoadError?: () => void;
}) {
  const focused = useIsFocused();
  const theme = useHtmlRenderTheme();
  const [initialTheme] = useState(theme);
  const stream = useRef<PreviewStreamRef>(null);
  useEffect(() => {
    stream.current?.command({ type: "embeddedMessage", message: htmlRenderThemeMessage(theme) });
  }, [theme]);
  return (
    <View
      style={
        props.nested
          ? { flex: 1 }
          : {
              flex: 1,
              paddingHorizontal: FULL_SCREEN_GUTTER,
              backgroundColor: theme.variables["--background"],
            }
      }
    >
      <PreviewStreamWebView
        ref={stream}
        environmentId={props.environmentId}
        threadId="embedded"
        tabId="embedded"
        embeddedType="html"
        embeddedAsset={props.uri + htmlRenderThemeFragment(initialTheme)}
        paused={!focused}
        interactive
        background={theme.variables["--background"] ?? "transparent"}
        onGone={props.onLoadError}
        onEmbeddedMessage={(message) => {
          const link = readHtmlRenderLinkRequest(message);
          if (!link) return;
          void tryOpenExternalUrl(link.url, "html-render").finally(() => {
            stream.current?.command({
              type: "embeddedMessage",
              message: htmlRenderResult(link.id),
            });
          });
        }}
        onStreamingChange={(streaming) => {
          if (streaming)
            stream.current?.command({
              type: "embeddedMessage",
              message: htmlRenderThemeMessage(theme),
            });
        }}
      />
    </View>
  );
}

/** A completed `html_render` call in the thread feed: the page itself, at a fixed height. */
export function ThreadHtmlRender(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly render: HtmlRenderReference;
  /** The feed's content width; the frame's height follows the page's measured height there. */
  readonly frameWidth: number;
  readonly iconColor: ColorValue;
}) {
  const navigation = useNavigation();
  const { attachmentId, title } = props.render;
  const height = htmlRenderFrameHeight(props.render, props.frameWidth);
  const fileName = htmlRenderFileName(title);
  const resource = useMemo(
    () => ({
      _tag: "attachment" as const,
      attachmentId,
      fileName,
      mimeType: "text/html",
      disposition: "inline" as const,
    }),
    [attachmentId, fileName],
  );
  const asset = useAssetUrlState(props.environmentId, resource);
  const refresh = useRefreshAssetUrl(props.environmentId, resource);
  // Signed URLs are re-minted periodically; following them would reload the page.
  const [uri, setUri] = useState<string | null>(null);
  if (uri === null && asset._tag === "Success") setUri(asset.url);
  const [failed, setFailed] = useState(false);
  // A failed load retries once with a fresh URL, or remounts on the same one,
  // since the failure may have been the connection rather than the URL.
  const [attempt, setAttempt] = useState(0);
  const retried = useRef(false);
  const handleLoadError = () => {
    if (retried.current) {
      setFailed(true);
      return;
    }
    retried.current = true;
    void refresh().then((next) => {
      if (next === null) setFailed(true);
      else if (next !== uri) setUri(next);
      else setAttempt((value) => value + 1);
    });
  };

  return (
    <View style={{ marginBottom: ROW_BOTTOM_MARGIN }}>
      <View style={{ height }}>
        {uri !== null && !failed ? (
          <HtmlRenderWebView
            environmentId={props.environmentId}
            key={`${uri}:${attempt}`}
            uri={uri}
            title={title}
            nested
            onLoadError={handleLoadError}
          />
        ) : failed || asset._tag === "Failure" ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Reload ${title}`}
            className="flex-1 items-center justify-center"
            onPress={() => {
              retried.current = false;
              setFailed(false);
              if (uri === null) void refresh().then((next) => next !== null && setUri(next));
            }}
          >
            <Text className="text-sm text-foreground-muted">Page unavailable</Text>
          </Pressable>
        ) : (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator />
          </View>
        )}
        {uri !== null && !failed ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${title}`}
            hitSlop={8}
            className="absolute right-1.5 top-1.5 h-7 w-7 items-center justify-center rounded-full border border-border/60 bg-surface/80"
            onPress={() =>
              navigation.navigate("ThreadAttachment", {
                environmentId: String(props.environmentId),
                threadId: String(props.threadId),
                attachmentId,
                name: fileName,
                mimeType: "text/html",
                sizeBytes: "0",
                htmlRender: "1",
              })
            }
          >
            <SymbolView
              name="arrow.up.left.and.arrow.down.right"
              size={12}
              tintColor={props.iconColor}
              type="monochrome"
            />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
