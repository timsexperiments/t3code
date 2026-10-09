import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  createEnvironmentNetwork,
  type EnvironmentHeaders,
  type EnvironmentWebSocket,
} from "@t3tools/client-runtime/environment-network";
import { createWebViewEnvironmentNetwork } from "./webview-network.browser";
import { createWebViewNetworkHost } from "./webview-network-host";
import type { NetworkReply } from "./webview-network-protocol";

class TestSocket extends EventTarget implements EnvironmentWebSocket {
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  readyState: WebSocket["readyState"] = 0;
  readonly extensions = "";
  readonly protocol = "";
  readonly bufferedAmount = 0;
  binaryType: BinaryType = "arraybuffer";
  onopen = null;
  onclose = null;
  onmessage = null;
  onerror = null;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = 3;
  });
  constructor(readonly url: string) {
    super();
  }
}

function setup(headers?: EnvironmentHeaders) {
  const cancel = vi.fn();
  let body: ReadableStreamDefaultController<Uint8Array> | undefined;
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            body = controller;
          },
          cancel,
        }),
        { headers: { "content-type": "application/octet-stream" } },
      ),
  );
  const sockets: TestSocket[] = [];
  const openWebSocket = vi.fn((url: string) => {
    const socket = new TestSocket(url);
    sockets.push(socket);
    return socket;
  });
  const network = createEnvironmentNetwork({ fetch, openWebSocket, headersForUrl: () => headers });
  const send = vi.fn<(reply: NetworkReply) => void>((reply) =>
    window.T3EnvironmentNetworkReceive(reply),
  );
  const host = createWebViewNetworkHost({ origin: "https://environment.test", network, send });
  const postMessage = vi.fn((data: string) => host.receive(data));
  vi.stubGlobal("window", { ReactNativeWebView: { postMessage } });
  const client = createWebViewEnvironmentNetwork();
  return {
    host,
    client,
    fetch,
    openWebSocket,
    sockets,
    cancel,
    postMessage,
    send,
    chunk: (bytes: number[]) => body?.enqueue(new Uint8Array(bytes)),
    end: () => body?.close(),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("WebView environment transport", () => {
  it.each([undefined, { "X-Service-Token": "test-service" }])(
    "streams binary HTTP data with headers %j",
    async (headers) => {
      const { client, host, fetch, chunk, end, postMessage } = setup(headers);
      const response = await client.fetch("https://environment.test/video", {
        headers: { Accept: "video/test" },
      });
      expect(response.headers.get("content-type")).toBe("application/octet-stream");
      const options = fetch.mock.calls[0]?.[1];
      expect(new Headers(options?.headers).get("X-Service-Token")).toBe(
        headers?.["X-Service-Token"] ?? null,
      );
      expect(new Headers(options?.headers).get("Accept")).toBe("video/test");
      const reader = response.body!.getReader();
      chunk([0, 255, 128, 3]);
      expect((await reader.read()).value).toEqual(new Uint8Array([0, 255, 128, 3]));
      end();
      expect((await reader.read()).done).toBe(true);
      expect(postMessage.mock.calls.some(([data]) => data.includes("test-service"))).toBe(false);
      host.dispose();
    },
  );

  it.each([undefined, { "X-Service-Token": "test-service" }])(
    "preserves socket frames, controls, close codes, and headers %j",
    async (headers) => {
      const { client, host, openWebSocket, sockets, postMessage } = setup(headers);
      const socket = client.openWebSocket("wss://environment.test/control", "stream");
      const native = sockets[0]!;
      const opened = new Promise<void>((resolve) =>
        socket.addEventListener("open", () => resolve()),
      );
      native.dispatchEvent(new Event("open"));
      await opened;
      expect(openWebSocket).toHaveBeenCalledWith(native.url, ["stream"], headers);
      const frame = new Promise<unknown>((resolve) =>
        socket.addEventListener("message", (event) => resolve(event.data), { once: true }),
      );
      native.dispatchEvent(
        new MessageEvent("message", { data: new Uint8Array([0, 255, 128]).buffer }),
      );
      expect(await frame).toEqual(new Uint8Array([0, 255, 128]).buffer);
      socket.send(new Uint8Array([9, 1, 2, 8]).subarray(1, 3));
      expect(native.send).toHaveBeenCalledWith(new Uint8Array([1, 2]));
      socket.send("control");
      expect(native.send).toHaveBeenCalledWith("control");
      const closed = new Promise<CloseEvent>((resolve) =>
        socket.addEventListener("close", resolve, { once: true }),
      );
      native.dispatchEvent(new CloseEvent("close", { code: 4401, reason: "expired" }));
      expect((await closed).code).toBe(4401);
      expect(postMessage.mock.calls.some(([data]) => data.includes("test-service"))).toBe(false);
      host.dispose();
    },
  );

  it("releases a failed native socket and reports an abnormal close", () => {
    const { client, host, sockets } = setup();
    const socket = client.openWebSocket("wss://environment.test/control");
    const closed = vi.fn();
    socket.addEventListener("close", closed);
    sockets[0]!.dispatchEvent(new Event("error"));
    expect(sockets[0]!.close).toHaveBeenCalledOnce();
    expect(closed.mock.calls[0]?.[0].code).toBe(1006);
    host.dispose();
    expect(sockets[0]!.close).toHaveBeenCalledOnce();
  });

  it("closes native sockets and ignores late frames after disposal", () => {
    const { client, host, sockets } = setup();
    const socket = client.openWebSocket("wss://environment.test/control");
    const received = vi.fn();
    socket.addEventListener("message", received);
    host.dispose();
    expect(sockets[0]!.close).toHaveBeenCalledOnce();
    sockets[0]!.dispatchEvent(new MessageEvent("message", { data: "late" }));
    expect(received).not.toHaveBeenCalled();
  });

  it("cancels a pending body read on abort and ignores later messages", async () => {
    const { client, host, cancel } = setup();
    const controller = new AbortController();
    const response = await client.fetch("https://environment.test/video", {
      signal: controller.signal,
    });
    const read = response.body!.getReader().read();
    controller.abort();
    await expect(read).rejects.toMatchObject({ name: "AbortError" });
    expect(cancel).toHaveBeenCalledOnce();
    host.dispose();
    expect(
      host.receive(JSON.stringify({ type: "environment-network", id: 1, operation: "read" })),
    ).toBe(false);
  });

  it("cancels native requests when the WebView is removed", async () => {
    const { client, host, fetch, cancel } = setup();
    await client.fetch("https://environment.test/video");
    host.dispose();
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects requests to another environment before making a network request", async () => {
    const { client, host, fetch } = setup({ "X-Service-Token": "test-service" });
    await expect(client.fetch("https://other.test/video")).rejects.toThrow(
      "outside this environment",
    );
    expect(fetch).not.toHaveBeenCalled();
    host.dispose();
  });

  it("rejects invalid messages without allocating a request", () => {
    const { host, fetch } = setup();
    expect(host.receive('{"type":"environment-network","id":"wrong","operation":"fetch"}')).toBe(
      false,
    );
    expect(host.receive("not JSON")).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    host.dispose();
  });
});
