import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type {
  EnvironmentNetwork,
  EnvironmentWebSocket,
} from "@t3tools/client-runtime/environment-network";
import {
  NetworkRequest,
  encodeNetworkBytes,
  decodeNetworkBytes,
  type NetworkReply,
} from "./webview-network-protocol";

const decodeRequest = Schema.decodeUnknownOption(NetworkRequest);
const requestOrigin = (url: string) => new URL(url.replace(/^ws/i, "http")).origin;

export function createWebViewNetworkHost(options: {
  readonly origin: string;
  readonly network: Pick<EnvironmentNetwork, "fetch" | "openWebSocket">;
  readonly send: (reply: NetworkReply) => void;
}) {
  const origin = requestOrigin(options.origin);
  const requests = new Map<
    number,
    { controller: AbortController; reader: ReadableStreamDefaultReader<Uint8Array> | null }
  >();
  const sockets = new Map<number, EnvironmentWebSocket>();
  let disposed = false;
  const send = (reply: NetworkReply) => {
    if (!disposed) options.send(reply);
  };
  const cancel = (id: number) => {
    const request = requests.get(id);
    requests.delete(id);
    request?.controller.abort();
    void request?.reader?.cancel().catch(() => undefined);
    const socket = sockets.get(id);
    sockets.delete(id);
    socket?.close();
  };
  const handle = async (message: NetworkRequest) => {
    const { id } = message;
    try {
      switch (message.operation) {
        case "fetch": {
          if (requestOrigin(message.url) !== origin)
            throw new Error("Request is outside this environment.");
          if (requests.has(id) || sockets.has(id))
            throw new Error("Request identifier is already active.");
          const request: {
            controller: AbortController;
            reader: ReadableStreamDefaultReader<Uint8Array> | null;
          } = { controller: new AbortController(), reader: null };
          requests.set(id, request);
          const response = await options.network.fetch(message.url, {
            method: message.method,
            signal: request.controller.signal,
            credentials: message.credentials,
            headers: message.headers,
          });
          if (requests.get(id) !== request) {
            await response.body?.cancel();
            return;
          }
          request.reader = response.body?.getReader() ?? null;
          send({
            id,
            operation: "response",
            status: response.status,
            headers: Object.fromEntries(response.headers),
          });
          return;
        }
        case "read": {
          const request = requests.get(id);
          if (!request) return;
          const result = await request.reader?.read();
          if (requests.get(id) !== request) return;
          if (!result || result.done) {
            requests.delete(id);
            request.reader?.releaseLock();
            send({ id, operation: "end" });
          } else
            send({ id, operation: "chunk", data: encodeNetworkBytes(result.value), binary: true });
          return;
        }
        case "socket": {
          if (requestOrigin(message.url) !== origin)
            throw new Error("Socket is outside this environment.");
          if (requests.has(id) || sockets.has(id))
            throw new Error("Request identifier is already active.");
          const socket = options.network.openWebSocket(message.url, [...message.protocols]);
          socket.binaryType = "arraybuffer";
          sockets.set(id, socket);
          socket.addEventListener("open", () => {
            if (sockets.get(id) === socket) send({ id, operation: "open" });
          });
          socket.addEventListener("message", (event) => {
            if (sockets.get(id) !== socket) return;
            if (typeof event.data === "string")
              send({ id, operation: "message", data: event.data, binary: false });
            else if (event.data instanceof ArrayBuffer)
              send({
                id,
                operation: "message",
                data: encodeNetworkBytes(new Uint8Array(event.data)),
                binary: true,
              });
          });
          socket.addEventListener("error", () => {
            if (sockets.get(id) !== socket) return;
            cancel(id);
            send({ id, operation: "error", message: "Network connection failed." });
          });
          socket.addEventListener("close", (event) => {
            if (sockets.get(id) !== socket) return;
            sockets.delete(id);
            send({ id, operation: "close", code: event.code, reason: event.reason });
          });
          return;
        }
        case "send":
          sockets.get(id)?.send(message.binary ? decodeNetworkBytes(message.data) : message.data);
          return;
        case "cancel":
        case "close":
          cancel(id);
          return;
      }
    } catch (cause) {
      cancel(id);
      send({
        id,
        operation: "error",
        message: cause instanceof Error ? cause.message : "Network request failed.",
      });
    }
  };
  return {
    receive(data: string): boolean {
      if (disposed) return false;
      let value: unknown;
      try {
        value = JSON.parse(data);
      } catch {
        return false;
      }
      const message = decodeRequest(value);
      if (Option.isNone(message)) return false;
      void handle(message.value);
      return true;
    },
    dispose() {
      disposed = true;
      for (const id of requests.keys()) cancel(id);
      for (const id of sockets.keys()) cancel(id);
    },
  };
}
