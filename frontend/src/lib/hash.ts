async function webCrypto(): Promise<Crypto> {
  if (globalThis.crypto?.subtle) return globalThis.crypto;
  const { webcrypto } = await import("node:crypto");
  return webcrypto as Crypto;
}

export async function sha256Hex(
  value: Blob | ArrayBuffer | ArrayBufferView | string,
): Promise<string> {
  let bytes: Uint8Array;
  if (typeof value === "string") {
    bytes = new TextEncoder().encode(value);
  } else if (value instanceof Blob) {
    bytes = new Uint8Array(await value.arrayBuffer());
  } else if (ArrayBuffer.isView(value)) {
    bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  } else {
    bytes = new Uint8Array(value);
  }
  const digest = await (await webCrypto()).subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
