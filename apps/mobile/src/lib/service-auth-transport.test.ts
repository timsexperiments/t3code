import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItem: () => null,
  setItemAsync: async () => undefined,
}));

import {
  makeEnvironmentServiceAuthWebSocketConstructor,
  withEnvironmentServiceAuth,
} from "./service-auth-transport";

const resolveHeaders = (url: string) =>
  new URL(url).hostname === "t3code.example.test"
    ? {
        "X-Service-Id": "service-client-id",
        "X-Service-Token": "service-client-secret",
      }
    : null;

describe("environment service-auth transport", () => {
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
