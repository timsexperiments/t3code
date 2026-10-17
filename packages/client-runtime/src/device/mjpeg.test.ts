import { describe, expect, it } from "vite-plus/test";
import { MjpegDemuxer } from "./mjpeg.ts";

const part = (bytes: number[]) => {
  const header = new TextEncoder().encode(
    `--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${bytes.length}\r\n\r\n`,
  );
  return new Uint8Array([...header, ...bytes, 13, 10]);
};
describe("MJPEG demuxing", () => {
  it("handles multipart headers and frames split across arbitrary reads", () => {
    const bytes = new Uint8Array([
      ...part([255, 216, 1, 255, 217]),
      ...part([255, 216, 2, 255, 217]),
    ]);
    const parser = new MjpegDemuxer();
    const frames: Uint8Array[] = [];
    for (const byte of bytes) frames.push(...parser.push(new Uint8Array([byte])));
    expect(frames.map((frame) => [...frame])).toEqual([
      [255, 216, 1, 255, 217],
      [255, 216, 2, 255, 217],
    ]);
  });
  it("handles concatenated native JPEG frames without treating metadata as frame boundaries", () => {
    const jpeg = [255, 216, 255, 225, 0, 4, 255, 217, 255, 218, 0, 2, 1, 255, 0, 2, 255, 217];
    const parser = new MjpegDemuxer();
    const frames: Uint8Array[] = [];
    for (const byte of [...jpeg, ...jpeg]) frames.push(...parser.push(new Uint8Array([byte])));
    expect(frames.map((frame) => [...frame])).toEqual([jpeg, jpeg]);
  });
  it("rejects unbounded frame lengths and malformed headers", () => {
    expect(() =>
      new MjpegDemuxer().push(new TextEncoder().encode("Content-Length: 999999999\r\n\r\n")),
    ).toThrow("frame length");
    expect(() => new MjpegDemuxer().push(new Uint8Array(16385))).toThrow("headers");
  });
});
