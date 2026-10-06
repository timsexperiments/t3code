import { describe, expect, it, vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import { HttpClient } from "effect/unstable/http";
import { remoteHttpClientLayer } from "@t3tools/client-runtime/rpc";

vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItem: () => null,
  setItemAsync: async () => undefined,
}));

import {
  makeEnvironmentServiceAuthWebSocketConstructor,
  withEnvironmentServiceAuth,
} from "./service-auth-transport";
import {
  clearServiceAuthDocumentForTests,
  makeCustomHeadersServiceAuth,
  setServiceAuthForUrl,
} from "../persistence/environment-service-auth";

const resolveHeaders = (url: string) =>
  new URL(url).hostname === "t3code.example.test"
    ? {
        "X-Service-Id": "service-client-id",
        "X-Service-Token": "service-client-secret",
      }
    : null;

describe("environment service-auth transport", () => {
  it("sends saved headers on discovery through the environment HTTP client", async () => {
    clearServiceAuthDocumentForTests();
    await setServiceAuthForUrl(
      "https://t3code.example.test/",
      makeCustomHeadersServiceAuth([
        { name: "X-Service-Id", value: "service-client-id" },
        { name: "X-Service-Token", value: "service-client-secret" },
      ]),
    );
    const fetchFn = vi.fn<typeof fetch>(() => Promise.resolve(new Response("{}")));
    await Effect.runPromise(
      HttpClient.get("https://t3code.example.test/.well-known/t3/environment").pipe(
        Effect.provide(remoteHttpClientLayer(withEnvironmentServiceAuth(fetchFn))),
      ),
    );
    const headers = new Headers(fetchFn.mock.calls[0]?.[1]?.headers);
    expect(headers.get("X-Service-Id")).toBe("service-client-id");
    expect(headers.get("X-Service-Token")).toBe("service-client-secret");
    clearServiceAuthDocumentForTests();
  });

  it("adds service headers only to the configured HTTP origin", async () => {
    const fetchFn = vi.fn<typeof fetch>(() => Promise.resolve(new Response()));
    const wrapped = withEnvironmentServiceAuth(fetchFn, resolveHeaders);

    await wrapped("https://t3code.example.test/api/environments", {
      headers: { Accept: "application/json" },
    });
    await wrapped("https://other.example.test/api/environments");

    const protectedInit = fetchFn.mock.calls[0]?.[1];
    expect(protectedInit?.redirect).toBe("manual");
    expect(new Headers(protectedInit?.headers).get("Accept")).toBe("application/json");
    expect(new Headers(protectedInit?.headers).get("X-Service-Id")).toBe("service-client-id");
    expect(new Headers(protectedInit?.headers).get("X-Service-Token")).toBe(
      "service-client-secret",
    );
    expect(fetchFn.mock.calls[1]).toEqual([
      "https://other.example.test/api/environments",
      undefined,
    ]);
  });

  it("adds service headers to the configured WebSocket origin", () => {
    const constructor = vi.fn(function FakeWebSocket() {});
    const makeWebSocket = makeEnvironmentServiceAuthWebSocketConstructor(
      resolveHeaders,
      constructor as never,
    );

    makeWebSocket("wss://t3code.example.test/rpc", "t3-code");
    makeWebSocket("wss://other.example.test/rpc", "t3-code");

    expect(constructor).toHaveBeenNthCalledWith(1, "wss://t3code.example.test/rpc", "t3-code", {
      headers: {
        "X-Service-Id": "service-client-id",
        "X-Service-Token": "service-client-secret",
      },
    });
    expect(constructor).toHaveBeenNthCalledWith(
      2,
      "wss://other.example.test/rpc",
      "t3-code",
      undefined,
    );
  });
});
