export class MjpegDemuxer {
  private bytes: Uint8Array<ArrayBuffer> = new Uint8Array();
  private length: number | null = null;
  private jpegOffset = 2;
  push(chunk: Uint8Array): Uint8Array<ArrayBuffer>[] {
    const bytes = new Uint8Array(this.bytes.length + chunk.length);
    bytes.set(this.bytes);
    bytes.set(chunk, this.bytes.length);
    this.bytes = bytes;
    const frames: Uint8Array<ArrayBuffer>[] = [];
    for (;;) {
      if (this.length === null && this.bytes[0] === 255 && this.bytes[1] === 216) {
        // URLSession removes multipart headers and delivers concatenated JPEG frames.
        let end = -1;
        while (this.jpegOffset + 1 < this.bytes.length) {
          const offset = this.jpegOffset;
          if (this.bytes[offset] !== 255) {
            this.jpegOffset++;
            continue;
          }
          const marker = this.bytes[offset + 1]!;
          if (marker === 217) {
            end = offset + 2;
            break;
          }
          if (marker === 0 || marker === 255 || (marker >= 208 && marker <= 216)) {
            this.jpegOffset += marker === 255 ? 1 : 2;
            continue;
          }
          if (offset + 3 >= this.bytes.length) break;
          const length = (this.bytes[offset + 2]! << 8) | this.bytes[offset + 3]!;
          if (length < 2) throw new Error("Invalid JPEG segment length.");
          if (offset + 2 + length > this.bytes.length) break;
          this.jpegOffset += 2 + length;
        }
        if (end < 0) {
          if (this.bytes.length > 16 * 1024 * 1024) throw new Error("Invalid MJPEG frame length.");
          break;
        }
        frames.push(this.bytes.slice(0, end));
        this.bytes = this.bytes.slice(end);
        this.jpegOffset = 2;
        continue;
      }
      if (this.length === null) {
        let end = -1;
        for (let i = 0; i + 3 < this.bytes.length; i++) {
          if (
            this.bytes[i] === 13 &&
            this.bytes[i + 1] === 10 &&
            this.bytes[i + 2] === 13 &&
            this.bytes[i + 3] === 10
          ) {
            end = i;
            break;
          }
        }
        if (end < 0) {
          if (this.bytes.length > 16_384) throw new Error("Invalid MJPEG headers.");
          break;
        }
        const match = /content-length:\s*(\d+)/i.exec(
          new TextDecoder().decode(this.bytes.subarray(0, end)),
        );
        const length = match ? Number(match[1]) : 0;
        if (length <= 0 || length > 16 * 1024 * 1024)
          throw new Error("Invalid MJPEG frame length.");
        this.length = length;
        this.bytes = this.bytes.slice(end + 4);
      }
      if (this.bytes.length < this.length) break;
      frames.push(this.bytes.slice(0, this.length));
      this.bytes = this.bytes.slice(this.length);
      this.length = null;
    }
    return frames;
  }
}
