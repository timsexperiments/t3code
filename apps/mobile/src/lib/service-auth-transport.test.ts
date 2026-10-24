import { describe, expect, it } from "@effect/vitest";
import { beforeEach, vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import { HttpClient } from "effect/http";
import { layerRemoteHttpClient } from "@t3tools/client-runtime/rpc";

vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItem: () => null,
  setItemAsync: async () => undefined,
}));

import {
  createEnvironmentNetwork,
  type EnvironmentNetwork,
} from "@t3tools/client-runtime/environment-network";
import {
  clearServiceAuthDocumentForTests,
  makeCustomHeadersServiceAuth,
  setServiceAuthForUrl,
  removeServiceAuthForUrl,
  serviceAuthHeadersForUrl,
} from "../persistence/environment-service-auth";

function network(
  fetchFn: typeof fetch,
  openWebSocket = vi.fn<EnvironmentNetwork["openWebSocket"]>(),
) {
  return createEnvironmentNetwork({
    fetch: fetchFn,
    openWebSocket,
    headersForUrl: (url) => serviceAuthHeadersForUrl(url) ?? undefined,
  });
}

describe("environment service-auth transport", () => {
  beforeEach(() => clearServiceAuthDocumentForTests());
  it.effect("sends saved headers on discovery through the environment HTTP client", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() =>
        setServiceAuthForUrl(
          "https://t3code.example.test/",
          makeCustomHeadersServiceAuth([
            { name: "X-Service-Id", value: "service-client-id" },
            { name: "X-Service-Token", value: "service-client-secret" },
          ]),
        ),
      );
      const fetchFn = vi.fn<typeof fetch>(() => Promise.resolve(new Response("{}")));
      yield* HttpClient.get("https://t3code.example.test/.well-known/t3/environment").pipe(
        Effect.provide(layerRemoteHttpClient(network(fetchFn).fetch)),
      );
      const headers = new Headers(fetchFn.mock.calls[0]?.[1]?.headers);
      expect(headers.get("X-Service-Id")).toBe("service-client-id");
      expect(headers.get("X-Service-Token")).toBe("service-client-secret");
    }),
  );

  it("preserves T3 authentication and request options when adding service headers", async () => {
    await setServiceAuthForUrl(
      "https://t3code.example.test",
      makeCustomHeadersServiceAuth([{ name: "X-Service-Token", value: "service-secret" }]),
    );
    const fetchFn = vi.fn<typeof fetch>(() => Promise.resolve(new Response()));
    const wrapped = network(fetchFn).fetch;
    const signal = new AbortController().signal;
    const options = {
      headers: { Authorization: "Bearer t3-token", DPoP: "t3-proof" },
      signal,
      redirect: "follow",
    } satisfies RequestInit;
    for (const input of [
      "https://t3code.example.test/api/auth/websocket-ticket",
      new URL("https://t3code.example.test/api/auth/websocket-ticket"),
      new Request("https://t3code.example.test/api/auth/websocket-ticket", {
        headers: { Accept: "application/json" },
      }),
    ]) {
      await wrapped(input, options);
      const init = fetchFn.mock.calls.at(-1)?.[1];
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe("Bearer t3-token");
      expect(headers.get("DPoP")).toBe("t3-proof");
      expect(headers.get("X-Service-Token")).toBe("service-secret");
      expect(init?.signal).toBe(signal);
      expect(init?.redirect).toBe("follow");
    }
    expect(new Headers(fetchFn.mock.calls.at(-1)?.[1]?.headers).get("Accept")).toBe(
      "application/json",
    );
    await wrapped("https://other.example.test/api", options);
    expect(fetchFn.mock.calls.at(-1)?.[1]).toBe(options);
  });

  it("resolves current headers for media and removes them when authentication is cleared", async () => {
    const transport = network(fetch);
    const url = "https://t3code.example.test/api/asset";
    expect(transport.mediaSource(url)).toEqual({ uri: url, headers: undefined });
    await setServiceAuthForUrl(
      url,
      makeCustomHeadersServiceAuth([{ name: "X-Service-Token", value: "test-service" }]),
    );
    expect(transport.mediaSource(url)).toEqual({
      uri: url,
      headers: { "X-Service-Token": "test-service" },
    });
    expect(transport.requestOptions("https://other.example.test/api")).toEqual({
      headers: undefined,
    });
    await removeServiceAuthForUrl(url);
    expect(transport.mediaSource(url)).toEqual({ uri: url, headers: undefined });
  });

  it("adds saved headers to WebSockets while preserving supplied headers and protocols", async () => {
    await setServiceAuthForUrl(
      "https://t3code.example.test",
      makeCustomHeadersServiceAuth([{ name: "X-Service-Token", value: "service-secret" }]),
    );
    const openWebSocket = vi.fn<EnvironmentNetwork["openWebSocket"]>();
    const makeWebSocket = network(fetch, openWebSocket).openWebSocket;

    makeWebSocket("wss://t3code.example.test/rpc", "t3-code");
    makeWebSocket("wss://other.example.test/rpc", "t3-code");
    makeWebSocket("wss://t3code.example.test/rpc", undefined, { "X-T3-Client": "mobile" });

    expect(openWebSocket).toHaveBeenNthCalledWith(1, "wss://t3code.example.test/rpc", "t3-code", {
      "X-Service-Token": "service-secret",
    });
    expect(openWebSocket).toHaveBeenNthCalledWith(3, "wss://t3code.example.test/rpc", undefined, {
      "X-T3-Client": "mobile",
      "X-Service-Token": "service-secret",
    });
    expect(openWebSocket).toHaveBeenNthCalledWith(
      2,
      "wss://other.example.test/rpc",
      "t3-code",
      undefined,
    );
  });
});
