// @effect-diagnostics globalFetch:off - Platform transport for browser and WebView clients outside the Effect runtime.
export type EnvironmentHeaders = Readonly<Record<string, string>>;

export type EnvironmentWebSocket = Omit<WebSocket, "ping">;

type SocketProtocols = string | string[];

export interface EnvironmentNetwork {
  readonly fetch: typeof fetch;
  readonly openWebSocket: (
    url: string,
    protocols?: SocketProtocols,
    headers?: EnvironmentHeaders,
  ) => EnvironmentWebSocket;
  readonly requestOptions: (url: string) => { readonly headers: EnvironmentHeaders | undefined };
  readonly mediaSource: (uri: string) => {
    readonly uri: string;
    readonly headers: EnvironmentHeaders | undefined;
  };
}

export function createEnvironmentNetwork(options: {
  readonly fetch: typeof fetch;
  readonly openWebSocket: EnvironmentNetwork["openWebSocket"];
  readonly headersForUrl?: (url: string) => EnvironmentHeaders | undefined;
}): EnvironmentNetwork {
  const requestOptions = (url: string) => ({ headers: options.headersForUrl?.(url) });
  const environmentFetch: typeof fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const serviceHeaders = requestOptions(url).headers;
    if (serviceHeaders === undefined) return options.fetch(input, init);
    const headers = new Headers(
      typeof input === "string" || input instanceof URL ? undefined : input.headers,
    );
    new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
    for (const [name, value] of Object.entries(serviceHeaders)) headers.set(name, value);
    return options.fetch(input, { ...init, headers });
  };
  return {
    fetch: environmentFetch,
    openWebSocket: (url, protocols, headers) => {
      const configuredHeaders = requestOptions(url).headers;
      return options.openWebSocket(
        url,
        protocols,
        headers === undefined && configuredHeaders === undefined
          ? undefined
          : { ...headers, ...configuredHeaders },
      );
    },
    requestOptions,
    mediaSource: (uri) => ({ uri, ...requestOptions(uri) }),
  };
}

export const browserEnvironmentNetwork = createEnvironmentNetwork({
  fetch: (...args) => globalThis.fetch(...args),
  openWebSocket: (url, protocols) => new WebSocket(url, protocols),
});
