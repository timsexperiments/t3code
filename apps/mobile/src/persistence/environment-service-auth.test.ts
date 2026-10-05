import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const secureValues = new Map<string, string>();

vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItem: (key: string) => secureValues.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => void secureValues.set(key, value),
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
});
