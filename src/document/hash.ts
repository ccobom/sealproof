export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Bytes(bytes: Uint8Array): Promise<Uint8Array> {
  const ownedBytes = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", ownedBytes.buffer);
  return new Uint8Array(digest);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return bytesToHex(await sha256Bytes(bytes));
}
