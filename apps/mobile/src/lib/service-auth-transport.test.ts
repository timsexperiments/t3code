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
  makeEnvironmentServiceAuthWebSocketConstructor,
  withEnvironmentServiceAuth,
} from "./service-auth-transport";
import {
  clearServiceAuthDocumentForTests,
  makeCustomHeadersServiceAuth,
  setServiceAuthForUrl,
} from "../persistence/environment-service-auth";

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
        Effect.provide(layerRemoteHttpClient(withEnvironmentServiceAuth(fetchFn))),
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
    const wrapped = withEnvironmentServiceAuth(fetchFn);
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

  it("adds saved headers to WebSockets while preserving supplied headers and protocols", async () => {
    await setServiceAuthForUrl(
      "https://t3code.example.test",
      makeCustomHeadersServiceAuth([{ name: "X-Service-Token", value: "service-secret" }]),
    );
    const constructor = vi.fn(function FakeWebSocket() {});
    const makeWebSocket = makeEnvironmentServiceAuthWebSocketConstructor(
      undefined,
      constructor as never,
    );

    makeWebSocket("wss://t3code.example.test/rpc", "t3-code");
    makeWebSocket("wss://other.example.test/rpc", "t3-code");
    makeWebSocket("wss://t3code.example.test/rpc", { headers: { "X-T3-Client": "mobile" } });

    expect(constructor).toHaveBeenNthCalledWith(1, "wss://t3code.example.test/rpc", "t3-code", {
      headers: {
        "X-Service-Token": "service-secret",
      },
    });
    expect(constructor).toHaveBeenNthCalledWith(3, "wss://t3code.example.test/rpc", undefined, {
      headers: { "X-T3-Client": "mobile", "X-Service-Token": "service-secret" },
    });
    expect(constructor).toHaveBeenNthCalledWith(
      2,
      "wss://other.example.test/rpc",
      "t3-code",
      undefined,
    );
  });
});
