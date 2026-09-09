import { describe, expect, it } from "vitest";
import { decryptTemporaryPdf, encryptTemporaryPdf } from "../../src/crypto/temporary-pdf";
import { sha256Hex } from "../../src/document/hash";

const PDF = new TextEncoder().encode("%PDF-1.7\nsynthetic private release\n%%EOF");
const TRANSACTION_ID = "transaction_pdf_001";
const KEY_VERSION = "kek-v1";

function key(seed = 0): Uint8Array {
  return Uint8Array.from({ length: 32 }, (_, index) => (index + seed) % 256);
}

function altered(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes);
  copy[0] ^= 1;
  return copy;
}

describe("temporary PDF application-level encryption", () => {
  it("round trips exact PDF bytes through a per-release envelope", async () => {
    const hash = await sha256Hex(PDF);
    const encrypted = await encryptTemporaryPdf(PDF, TRANSACTION_ID, hash, KEY_VERSION, key());

    expect(encrypted.ciphertext).not.toEqual(PDF);
    expect(new TextDecoder().decode(encrypted.ciphertext)).not.toContain("synthetic private release");
    await expect(decryptTemporaryPdf(
      encrypted.ciphertext,
      encrypted.metadata,
      TRANSACTION_ID,
      hash,
      { [KEY_VERSION]: key() },
    )).resolves.toEqual(PDF);
  });

  it("uses fresh document and key-wrapping randomness", async () => {
    const hash = await sha256Hex(PDF);
    const first = await encryptTemporaryPdf(PDF, TRANSACTION_ID, hash, KEY_VERSION, key());
    const second = await encryptTemporaryPdf(PDF, TRANSACTION_ID, hash, KEY_VERSION, key());

    expect(first.ciphertext).not.toEqual(second.ciphertext);
    expect(first.metadata.documentIv).not.toBe(second.metadata.documentIv);
    expect(first.metadata.wrappedKeyIv).not.toBe(second.metadata.wrappedKeyIv);
    expect(first.metadata.wrappedKey).not.toBe(second.metadata.wrappedKey);
  });

  it("rejects altered ciphertext, authenticated metadata, and transaction binding", async () => {
    const hash = await sha256Hex(PDF);
    const encrypted = await encryptTemporaryPdf(PDF, TRANSACTION_ID, hash, KEY_VERSION, key());

    await expect(decryptTemporaryPdf(
      altered(encrypted.ciphertext), encrypted.metadata, TRANSACTION_ID, hash, { [KEY_VERSION]: key() },
    )).rejects.toThrow();
    await expect(decryptTemporaryPdf(
      encrypted.ciphertext,
      { ...encrypted.metadata, plaintextBytes: encrypted.metadata.plaintextBytes + 1 },
      TRANSACTION_ID,
      hash,
      { [KEY_VERSION]: key() },
    )).rejects.toThrow();
    await expect(decryptTemporaryPdf(
      encrypted.ciphertext, encrypted.metadata, "transaction_pdf_002", hash, { [KEY_VERSION]: key() },
    )).rejects.toThrow();
  });

  it("rejects a wrong wrapping key, missing key version, and false source hash", async () => {
    const hash = await sha256Hex(PDF);
    const encrypted = await encryptTemporaryPdf(PDF, TRANSACTION_ID, hash, KEY_VERSION, key());

    await expect(decryptTemporaryPdf(
      encrypted.ciphertext, encrypted.metadata, TRANSACTION_ID, hash, { [KEY_VERSION]: key(1) },
    )).rejects.toThrow();
    await expect(decryptTemporaryPdf(
      encrypted.ciphertext, encrypted.metadata, TRANSACTION_ID, hash, {},
    )).rejects.toThrow("Required key-encryption-key version is unavailable");
    await expect(encryptTemporaryPdf(
      PDF, TRANSACTION_ID, "0".repeat(64), KEY_VERSION, key(),
    )).rejects.toThrow("PDF does not match its document hash");
  });
});
