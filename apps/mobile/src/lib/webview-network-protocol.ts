import * as Schema from "effect/Schema";

const id = { type: Schema.Literal("environment-network"), id: Schema.Int };
export const NetworkRequest = Schema.Union([
  Schema.Struct({
    ...id,
    operation: Schema.Literal("fetch"),
    url: Schema.String,
    method: Schema.Literals(["GET", "HEAD"]),
    credentials: Schema.Literals(["include", "omit", "same-origin"]),
    headers: Schema.Record(Schema.String, Schema.String),
  }),
  Schema.Struct({
    ...id,
    operation: Schema.Literal("socket"),
    url: Schema.String,
    protocols: Schema.Array(Schema.String),
  }),
  Schema.Struct({
    ...id,
    operation: Schema.Literal("send"),
    data: Schema.String,
    binary: Schema.Boolean,
  }),
  Schema.Struct({ ...id, operation: Schema.Literals(["read", "cancel", "close"]) }),
]);
export type NetworkRequest = typeof NetworkRequest.Type;
export type NetworkReply =
  | {
      readonly id: number;
      readonly operation: "response";
      readonly status: number;
      readonly headers: Record<string, string>;
    }
  | { readonly id: number; readonly operation: "open" | "end" }
  | {
      readonly id: number;
      readonly operation: "chunk" | "message";
      readonly data: string;
      readonly binary: boolean;
    }
  | {
      readonly id: number;
      readonly operation: "close";
      readonly code: number;
      readonly reason: string;
    }
  | { readonly id: number; readonly operation: "error"; readonly message: string };

export function encodeNetworkBytes(bytes: Uint8Array): string {
  let value = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    value += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(value);
}

export function decodeNetworkBytes(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}
