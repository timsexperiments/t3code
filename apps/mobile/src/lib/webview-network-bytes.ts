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
