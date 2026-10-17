import { createEnvironmentNetwork } from "@t3tools/client-runtime/environment-network";
import { fetch as expoFetch } from "expo/fetch";
import { serviceAuthHeadersForUrl } from "../persistence/environment-service-auth";

interface MobileWebSocketConstructor {
  new (
    url: string,
    protocols?: string | string[],
    options?: {
      readonly headers: Readonly<Record<string, string>>;
    },
  ): WebSocket;
}

const MobileWebSocket: MobileWebSocketConstructor = globalThis.WebSocket;

export const environmentNetwork = createEnvironmentNetwork({
  fetch: expoFetch,
  openWebSocket: (url, protocols, headers) =>
    new MobileWebSocket(url, protocols, headers === undefined ? undefined : { headers }),
  headersForUrl: (url) => serviceAuthHeadersForUrl(url) ?? undefined,
});

export const environmentFetch = environmentNetwork.fetch;
export const environmentWebSocket = environmentNetwork.openWebSocket;
export const environmentRequestOptions = environmentNetwork.requestOptions;
export const environmentMediaSource = environmentNetwork.mediaSource;
