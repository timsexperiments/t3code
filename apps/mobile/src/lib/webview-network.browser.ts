import type {
  EnvironmentNetwork,
  EnvironmentWebSocket,
} from "@t3tools/client-runtime/environment-network";
import {
  decodeNetworkBytes,
  encodeNetworkBytes,
  type NetworkRequest,
  type NetworkReply,
} from "./webview-network-protocol";

declare global {
  interface Window {
    T3EnvironmentNetworkReceive: (reply: NetworkReply) => void;
  }
}

export function createWebViewEnvironmentNetwork(): Pick<
  EnvironmentNetwork,
  "fetch" | "openWebSocket"
> {
  let nextId = 0;
  const receivers = new Map<number, (reply: NetworkReply) => void>();
  window.T3EnvironmentNetworkReceive = (reply) => receivers.get(reply.id)?.(reply);
  const post = (message: NetworkRequest) =>
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- The native WebView channel takes one string.
    window.ReactNativeWebView.postMessage(JSON.stringify(message));
  const release = (id: number) => receivers.delete(id);

  class EnvironmentSocket extends EventTarget implements EnvironmentWebSocket {
    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readonly CLOSING = 2;
    readonly CLOSED = 3;
    readonly extensions = "";
    readonly protocol = "";
    readonly bufferedAmount = 0;
    binaryType: BinaryType = "arraybuffer";
    readyState: WebSocket["readyState"] = this.CONNECTING;
    onopen: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onclose: ((event: CloseEvent) => void) | null = null;
    private readonly id = ++nextId;
    constructor(
      readonly url: string,
      protocols?: string | string[],
    ) {
      super();
      receivers.set(this.id, (reply) => {
        switch (reply.operation) {
          case "open": {
            this.readyState = this.OPEN;
            const event = new Event("open");
            this.dispatchEvent(event);
            this.onopen?.(event);
            return;
          }
          case "message": {
            const data = reply.binary ? decodeNetworkBytes(reply.data).buffer : reply.data;
            const event = new MessageEvent("message", { data });
            this.dispatchEvent(event);
            this.onmessage?.(event);
            return;
          }
          case "error": {
            this.closed(1006, reply.message);
            const event = new Event("error");
            this.dispatchEvent(event);
            this.onerror?.(event);
            return;
          }
          case "close":
            this.closed(reply.code, reply.reason);
            return;
        }
      });
      post({
        type: "environment-network",
        operation: "socket",
        id: this.id,
        url,
        protocols: typeof protocols === "string" ? [protocols] : (protocols ?? []),
      });
    }
    private closed(code: number, reason: string) {
      if (this.readyState === this.CLOSED) return;
      this.readyState = this.CLOSED;
      release(this.id);
      const event = new CloseEvent("close", { code, reason });
      this.dispatchEvent(event);
      this.onclose?.(event);
    }
    close(code = 1000, reason = "") {
      if (this.readyState === this.CLOSED) return;
      post({ type: "environment-network", operation: "close", id: this.id });
      this.closed(code, reason);
    }
    send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
      if (this.readyState !== this.OPEN)
        throw new DOMException("Socket is not open.", "InvalidStateError");
      if (data instanceof Blob) {
        void data.arrayBuffer().then((value) => this.send(value));
        return;
      }
      const binary = typeof data !== "string";
      const value =
        typeof data === "string"
          ? data
          : encodeNetworkBytes(
              ArrayBuffer.isView(data)
                ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
                : new Uint8Array(data),
            );
      post({ type: "environment-network", operation: "send", id: this.id, binary, data: value });
    }
  }

  const environmentFetch: typeof fetch = (input, init) => {
    const request = new Request(input, init);
    if (request.method !== "GET" && request.method !== "HEAD")
      return Promise.reject(new Error("Stream transport only supports reads."));
    const id = ++nextId;
    return new Promise<Response>((resolve, reject) => {
      let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
      let readComplete: (() => void) | null = null;
      const cleanup = () => {
        release(id);
        request.signal.removeEventListener("abort", abort);
        readComplete?.();
      };
      const abort = () => {
        post({ type: "environment-network", operation: "cancel", id });
        const error = new DOMException("Request aborted.", "AbortError");
        controller?.error(error);
        reject(error);
        cleanup();
      };
      receivers.set(id, (reply) => {
        switch (reply.operation) {
          case "response": {
            if ([204, 205, 304].includes(reply.status) || request.method === "HEAD") {
              resolve(new Response(null, { status: reply.status, headers: reply.headers }));
              post({ type: "environment-network", operation: "cancel", id });
              cleanup();
              return;
            }
            const body = new ReadableStream<Uint8Array>({
              start(value) {
                controller = value;
              },
              pull() {
                return new Promise<void>((done) => {
                  readComplete = done;
                  post({ type: "environment-network", operation: "read", id });
                });
              },
              cancel() {
                post({ type: "environment-network", operation: "cancel", id });
                cleanup();
              },
            });
            resolve(new Response(body, { status: reply.status, headers: reply.headers }));
            return;
          }
          case "chunk":
            controller?.enqueue(decodeNetworkBytes(reply.data));
            readComplete?.();
            readComplete = null;
            return;
          case "end":
            controller?.close();
            cleanup();
            return;
          case "error": {
            const error = new Error(reply.message);
            controller?.error(error);
            reject(error);
            cleanup();
            return;
          }
        }
      });
      if (request.signal.aborted) {
        abort();
        return;
      }
      request.signal.addEventListener("abort", abort, { once: true });
      post({
        type: "environment-network",
        operation: "fetch",
        id,
        url: request.url,
        method: request.method === "HEAD" ? "HEAD" : "GET",
        credentials: request.credentials,
        headers: Object.fromEntries(request.headers),
      });
    });
  };
  return {
    fetch: environmentFetch,
    openWebSocket: (url, protocols) => new EnvironmentSocket(url, protocols),
  };
}
