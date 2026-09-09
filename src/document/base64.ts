const CHUNK_BYTES = 32_768;

export function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];

  for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
    const chunk = bytes.subarray(offset, offset + CHUNK_BYTES);
    chunks.push(String.fromCharCode(...chunk));
  }

  return btoa(chunks.join(""));
}
