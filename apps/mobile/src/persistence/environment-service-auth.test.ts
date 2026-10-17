import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const secureValues = new Map<string, string>();
const writes = vi.hoisted(() => ({ failNext: false }));

vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItem: (key: string) => secureValues.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    if (writes.failNext) {
      writes.failNext = false;
      throw new Error("Keychain unavailable");
    }
    secureValues.set(key, value);
  },
}));

import {
  clearServiceAuthDocumentForTests,
  makeCustomHeadersServiceAuth,
  moveServiceAuth,
  normalizeServiceAuthOrigin,
  removeServiceAuthForUrl,
  serviceAuthForUrl,
  serviceAuthHeadersForUrl,
  setServiceAuthForUrl,
} from "./environment-service-auth";

describe("environment service authentication", () => {
  beforeEach(() => {
    secureValues.clear();
    writes.failNext = false;
    clearServiceAuthDocumentForTests();
  });

  it("keeps credentials isolated by HTTPS origin and port", async () => {
    const first = makeCustomHeadersServiceAuth([{ name: "X-Service-Token", value: "first" }]);
    const second = makeCustomHeadersServiceAuth([{ name: "X-Service-Token", value: "second" }]);
    const port = makeCustomHeadersServiceAuth([{ name: "X-Service-Token", value: "port" }]);
    await setServiceAuthForUrl("https://first.example", first);
    await setServiceAuthForUrl("https://second.example", second);
    await setServiceAuthForUrl("https://first.example:8443", port);

    for (const [url, token] of [
      ["https://first.example/api", "first"],
      ["wss://FIRST.example:443/rpc", "first"],
      ["https://second.example/api", "second"],
      ["https://first.example:8443/assets", "port"],
      ["https://first.example:444/assets", null],
      ["https://other.example/api", null],
      ["https://first.example.evil/api", null],
      ["http://first.example/api", null],
      ["ws://first.example/rpc", null],
      ["file:///first.example/image.png", null],
      ["not a URL", null],
    ] as const) {
      expect(serviceAuthHeadersForUrl(url), url).toEqual(
        token === null ? null : { "X-Service-Token": token },
      );
    }
    expect(() => normalizeServiceAuthOrigin("http://first.example")).toThrow("requires an HTTPS");
  });

  it("rejects authentication and transport-owned headers", () => {
    for (const name of [
      "Authorization",
      "authorization",
      "DPoP",
      "dpop",
      "Host",
      "Sec-WebSocket-Key",
    ]) {
      expect(() => makeCustomHeadersServiceAuth([{ name, value: "token" }]), name).toThrow(
        "cannot be configured",
      );
    }
  });

  it("ignores reserved authentication headers saved by older builds", async () => {
    secureValues.set(
      "t3code.environment-service-auth.v1",
      JSON.stringify({
        schemaVersion: 1,
        entries: [
          {
            origin: "https://legacy.example",
            auth: {
              _tag: "CustomHeadersServiceAuth",
              headers: [
                { name: "Authorization", value: "old-token" },
                { name: "DPoP", value: "old-proof" },
                { name: "X-Service-Token", value: "service-token" },
              ],
            },
          },
        ],
      }),
    );
    vi.resetModules();
    const stored = await import("./environment-service-auth");
    expect(stored.serviceAuthHeadersForUrl("https://legacy.example/api")).toEqual({
      "X-Service-Token": "service-token",
    });
  });

  it("rejects duplicate and malformed header names", () => {
    expect(() =>
      makeCustomHeadersServiceAuth([
        { name: "X-Service-Token", value: "first" },
        { name: "x-service-token", value: "second" },
      ]),
    ).toThrow("more than once");
    expect(() => makeCustomHeadersServiceAuth([{ name: "Invalid Name", value: "token" }])).toThrow(
      "Invalid service-auth header name",
    );
  });

  it("moves and removes credentials with an edited environment URL", async () => {
    const auth = makeCustomHeadersServiceAuth([{ name: "X-Service-Token", value: "secret" }]);
    await setServiceAuthForUrl("https://old.example.test", auth);
    await moveServiceAuth("https://old.example.test", "https://new.example.test", auth);

    expect(serviceAuthForUrl("https://old.example.test")).toBeNull();
    expect(serviceAuthForUrl("https://new.example.test")).toEqual(auth);

    await removeServiceAuthForUrl("https://new.example.test");
    expect(serviceAuthForUrl("https://new.example.test")).toBeNull();
  });

  it("allows unauthenticated HTTP environments to be edited", async () => {
    await expect(
      moveServiceAuth("http://192.168.1.10:3773", "http://192.168.1.11:3773", null),
    ).resolves.toBeUndefined();
  });

  it("preserves independent origins when writes overlap", async () => {
    const auth = makeCustomHeadersServiceAuth([{ name: "X-Service-Token", value: "token" }]);
    await Promise.all([
      setServiceAuthForUrl("https://first.example", auth),
      setServiceAuthForUrl("https://second.example", auth),
      moveServiceAuth("https://first.example", "https://third.example", auth),
      removeServiceAuthForUrl("https://second.example"),
      setServiceAuthForUrl("https://fourth.example", auth),
    ]);
    expect(serviceAuthForUrl("https://first.example")).toBeNull();
    expect(serviceAuthForUrl("https://second.example")).toBeNull();
    expect(serviceAuthForUrl("https://third.example")).toEqual(auth);
    expect(serviceAuthForUrl("https://fourth.example")).toEqual(auth);
  });

  it("leaves credentials unchanged after a failed write and allows the next save", async () => {
    const auth = makeCustomHeadersServiceAuth([{ name: "X-Service-Token", value: "token" }]);
    await setServiceAuthForUrl("https://first.example", auth);
    writes.failNext = true;
    const results = await Promise.allSettled([
      removeServiceAuthForUrl("https://first.example"),
      setServiceAuthForUrl("https://second.example", auth),
    ]);
    expect(results.map((result) => result.status)).toEqual(["rejected", "fulfilled"]);
    expect(serviceAuthForUrl("https://first.example")).toEqual(auth);
    expect(serviceAuthForUrl("https://second.example")).toEqual(auth);
  });

  it.each(["value\r\nX-Injected: yes", "value\n", "\u0000", "\u007f", "   ", "tökén", "🔑"])(
    "rejects invalid values before they reach a native transport",
    (value) => {
      expect(() => makeCustomHeadersServiceAuth([{ name: "X-Service-Token", value }])).toThrow();
    },
  );
});
