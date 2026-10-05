import * as Socket from "effect/unstable/socket/Socket";

import { serviceAuthHeadersForUrl } from "../persistence/environment-service-auth";

type HeaderResolver = (url: string) => Readonly<Record<string, string>> | null;

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}

function requestHeaders(input: Parameters<typeof fetch>[0]): HeadersInit | undefined {
  return typeof input === "string" || input instanceof URL ? undefined : input.headers;
}

export function withEnvironmentServiceAuth(
  fetchFn: typeof fetch,
  resolveHeaders: HeaderResolver = serviceAuthHeadersForUrl,
): typeof fetch {
  return (input, init) => {
    const serviceHeaders = resolveHeaders(requestUrl(input));
    if (serviceHeaders === null) {
      return fetchFn(input, init);
    }

    const mergedHeaders = new Headers(requestHeaders(input));
    new Headers(init?.headers).forEach((value, name) => mergedHeaders.set(name, value));
    for (const [name, value] of Object.entries(serviceHeaders)) {
      mergedHeaders.set(name, value);
    }
    // A followed cross-origin redirect could forward custom service headers.
    // Credentialed environment requests therefore surface redirects to the
    // caller instead of allowing the native fetch stack to follow them.
    return fetchFn(input, { ...init, headers: mergedHeaders, redirect: "manual" });
  };
}

interface ReactNativeWebSocketConstructor {
  new (
    url: string,
    protocols?: string | Array<string> | null,
    options?: { readonly headers: Readonly<Record<string, string>> } | null,
  ): Socket.WebSocketLike;
}

export function makeEnvironmentServiceAuthWebSocketConstructor(
  resolveHeaders: HeaderResolver = serviceAuthHeadersForUrl,
  WebSocketImpl: ReactNativeWebSocketConstructor = globalThis.WebSocket as unknown as ReactNativeWebSocketConstructor,
): (url: string, options?: Socket.WebSocketConstructorOptions) => Socket.WebSocketLike {
  return (url, options) => {
    const protocols = typeof options === "string" || Array.isArray(options) ? options : undefined;
    const serviceHeaders = resolveHeaders(url);
    const supplied =
      typeof options === "object" && !Array.isArray(options) ? options.headers : undefined;
    const headers = serviceHeaders || supplied ? { ...supplied, ...serviceHeaders } : undefined;

    return new WebSocketImpl(url, protocols, headers ? { headers } : undefined);
  };
}
