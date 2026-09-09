import { describe, expect, it } from "vitest";
import {
  decryptTemporaryEmailAddresses,
  encryptTemporaryEmailAddresses,
  type EncryptedTemporaryEmailAddresses,
} from "../../src/crypto/temporary-pii";

const ADDRESSES = {
  productionEmail: "producer@example.invalid",
  signerEmail: "signer@example.invalid",
};
const TRANSACTION_ID = "transaction_test_001";
const KEY_VERSION = "v1";

function makeKey(seed = 0): Uint8Array {
  return Uint8Array.from({ length: 32 }, (_, index) => (index + seed) % 256);
}

function alterBase64(value: string): string {
  const replacement = value[0] === "A" ? "B" : "A";
  return replacement + value.slice(1);
}

describe("temporary email-address encryption", () => {
  it("round trips both addresses through a versioned envelope", async () => {
    const encrypted = await encryptTemporaryEmailAddresses(
      ADDRESSES,
      TRANSACTION_ID,
      KEY_VERSION,
      makeKey(),
    );

    await expect(decryptTemporaryEmailAddresses(
      encrypted,
      TRANSACTION_ID,
      { [KEY_VERSION]: makeKey() },
    )).resolves.toEqual(ADDRESSES);
  });

  it("produces different stored values for identical inputs", async () => {
    const first = await encryptTemporaryEmailAddresses(ADDRESSES, TRANSACTION_ID, KEY_VERSION, makeKey());
    const second = await encryptTemporaryEmailAddresses(ADDRESSES, TRANSACTION_ID, KEY_VERSION, makeKey());

    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(first.wrappedKey).not.toBe(second.wrappedKey);
    expect(first.envelopeIv).not.toBe(second.envelopeIv);
    expect(first.wrappedKeyIv).not.toBe(second.wrappedKeyIv);
  });

  it("does not serialize either plaintext address", async () => {
    const encrypted = await encryptTemporaryEmailAddresses(ADDRESSES, TRANSACTION_ID, KEY_VERSION, makeKey());
    const stored = JSON.stringify(encrypted);

    expect(stored).not.toContain(ADDRESSES.productionEmail);
    expect(stored).not.toContain(ADDRESSES.signerEmail);
  });

  it("fails authentication when bound to a different transaction", async () => {
    const encrypted = await encryptTemporaryEmailAddresses(ADDRESSES, TRANSACTION_ID, KEY_VERSION, makeKey());

    await expect(decryptTemporaryEmailAddresses(
      encrypted,
      "transaction_test_002",
      { [KEY_VERSION]: makeKey() },
    )).rejects.toThrow();
  });

  it("fails authentication after ciphertext alteration", async () => {
    const encrypted = await encryptTemporaryEmailAddresses(ADDRESSES, TRANSACTION_ID, KEY_VERSION, makeKey());
    const altered: EncryptedTemporaryEmailAddresses = {
      ...encrypted,
      ciphertext: alterBase64(encrypted.ciphertext),
    };

    await expect(decryptTemporaryEmailAddresses(
      altered,
      TRANSACTION_ID,
      { [KEY_VERSION]: makeKey() },
    )).rejects.toThrow();
  });

  it("fails authentication after wrapped-key alteration", async () => {
    const encrypted = await encryptTemporaryEmailAddresses(ADDRESSES, TRANSACTION_ID, KEY_VERSION, makeKey());
    const altered: EncryptedTemporaryEmailAddresses = {
      ...encrypted,
      wrappedKey: alterBase64(encrypted.wrappedKey),
    };

    await expect(decryptTemporaryEmailAddresses(
      altered,
      TRANSACTION_ID,
      { [KEY_VERSION]: makeKey() },
    )).rejects.toThrow();
  });

  it("fails with the wrong key and with a missing key version", async () => {
    const encrypted = await encryptTemporaryEmailAddresses(ADDRESSES, TRANSACTION_ID, KEY_VERSION, makeKey());

    await expect(decryptTemporaryEmailAddresses(
      encrypted,
      TRANSACTION_ID,
      { [KEY_VERSION]: makeKey(1) },
    )).rejects.toThrow();
    await expect(decryptTemporaryEmailAddresses(
      encrypted,
      TRANSACTION_ID,
      {},
    )).rejects.toThrow("Required key-encryption-key version is unavailable");
  });
});
