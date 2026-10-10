import { useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import type { WebView } from "react-native-webview";
import { environmentNetwork } from "./environment-network";
import { createWebViewNetworkHost } from "./webview-network-host";

export function useWebViewEnvironmentNetwork(
  view: RefObject<WebView<object> | null>,
  origin: string,
) {
  const host = useRef<ReturnType<typeof createWebViewNetworkHost> | null>(null);
  useLayoutEffect(() => {
    const network = createWebViewNetworkHost({
      origin,
      network: environmentNetwork,
      send: (reply) =>
        view.current?.injectJavaScript(
          `window.T3EnvironmentNetworkReceive?.(${JSON.stringify(reply).replace(/</g, "\\u003c")}); true;`,
        ),
    });
    host.current = network;
    return () => {
      network.dispose();
      host.current = null;
    };
  }, [origin, view]);
  return useMemo(
    () => ({
      receive: (data: string) => host.current?.receive(data) ?? false,
      dispose: () => host.current?.dispose(),
    }),
    [],
  );
}
