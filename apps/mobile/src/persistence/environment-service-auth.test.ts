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

  it("normalizes secure HTTP and WebSocket URLs to the same exact origin", () => {
    expect(normalizeServiceAuthOrigin("https://T3CODE.example.test/path")).toBe(
      "https://t3code.example.test",
    );
    expect(normalizeServiceAuthOrigin("wss://t3code.example.test/rpc")).toBe(
      "https://t3code.example.test",
    );
    expect(() => normalizeServiceAuthOrigin("http://t3code.example.test")).toThrow(
      "requires an HTTPS environment URL",
    );
  });

  it("stores custom credentials and resolves them only for the matching origin", async () => {
    await setServiceAuthForUrl(
      "https://t3code.example.test",
      makeCustomHeadersServiceAuth([{ name: "X-Service-Token", value: "service-token" }]),
    );

    expect(serviceAuthHeadersForUrl("wss://t3code.example.test/rpc")).toEqual({
      "X-Service-Token": "service-token",
    });
    expect(serviceAuthHeadersForUrl("https://other.example.test/rpc")).toBeNull();
  });

  it("supports custom headers while rejecting transport-owned headers", async () => {
    await setServiceAuthForUrl(
      "https://t3code.example.test",
      makeCustomHeadersServiceAuth([
        { name: "Authorization", value: "Bearer service-token" },
        { name: "X-Remote-User", value: "mobile" },
      ]),
    );

    expect(serviceAuthHeadersForUrl("https://t3code.example.test/api")).toEqual({
      Authorization: "Bearer service-token",
      "X-Remote-User": "mobile",
    });
    expect(() => makeCustomHeadersServiceAuth([{ name: "Host", value: "wrong.test" }])).toThrow(
      "cannot be configured",
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

  it.each(["value\r\nX-Injected: yes", "value\n", "\u0000", "\u007f", "   "])(
    "rejects invalid values before they reach a native transport",
    (value) => {
      expect(() => makeCustomHeadersServiceAuth([{ name: "X-Service-Token", value }])).toThrow();
    },
  );
});
