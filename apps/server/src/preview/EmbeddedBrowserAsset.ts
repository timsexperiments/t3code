import * as Effect from "effect/Effect";
import * as Mime from "effect/http/Mime";
import * as Stream from "effect/Stream";
import * as Option from "effect/Option";
import * as FileSystem from "effect/FileSystem";
import { ASSET_ROUTE_PREFIX, resolveAsset } from "../assets/AssetAccess.ts";
import { assetResponseHeaders } from "../http.ts";
import { EMBEDDED_ORIGIN, type EmbeddedBrowserDocument } from "./EmbeddedBrowserPage.ts";

/** A signed asset retains its existing file scope when rendered on the host. */
export const embeddedBrowserAsset = Effect.fn("embeddedBrowserAsset")(function* (path: string) {
  const url = new URL(path, EMBEDDED_ORIGIN);
  const prefix = `${ASSET_ROUTE_PREFIX}/`;
  if (
    !/^(https?:)$/.test(url.protocol) ||
    url.username !== "" ||
    url.password !== "" ||
    !url.pathname.startsWith(prefix)
  )
    return null;
  const token = url.pathname.slice(prefix.length).split("/", 1)[0];
  if (!token) return null;
  const allowedPrefix = `${prefix}${token}/`;
  const fs = yield* FileSystem.FileSystem;
  const services = yield* Effect.context<Effect.Services<ReturnType<typeof resolveAsset>>>();
  const load: EmbeddedBrowserDocument["load"] = async (requestUrl) => {
    const request = new URL(requestUrl);
    if (request.origin !== url.origin || !request.pathname.startsWith(allowedPrefix)) return null;
    const relativePath = decodeURIComponent(request.pathname.slice(allowedPrefix.length));
    const asset = await Effect.runPromiseWith(services)(resolveAsset(token, relativePath));
    if (!asset || asset.kind !== "file" || ("download" in asset && asset.download)) return null;
    const info = await Effect.runPromise(fs.stat(asset.path));
    if (info.size > 25n * 1024n * 1024n) return null;
    const body = await Effect.runPromise(
      fs.stream(asset.path, { bytesToRead: 25 * 1024 * 1024 + 1 }).pipe(Stream.mkUint8Array),
    );
    if (body.byteLength > 25 * 1024 * 1024) return null;
    return {
      body,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": Option.getOrElse(
          Mime.getType(asset.path),
          () => "application/octet-stream",
        ),
        ...assetResponseHeaders(asset.path, asset),
      },
    };
  };
  const document = { url: url.href, load } satisfies EmbeddedBrowserDocument;
  const initial = yield* Effect.tryPromise(() => load(url.href)).pipe(
    Effect.orElseSucceed(() => null),
  );
  return initial && initial.headers["Content-Type"]?.startsWith("text/html") ? document : null;
});
