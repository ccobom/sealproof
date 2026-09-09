import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/document/hash";
import {
  createReleaseState,
  loadTemporaryEmailAddresses,
  type CreateReleaseStateInput,
} from "../../src/release/release-state";

const FINALIZED_AT = 1_800_000_000_000;
const EXPIRES_AT = FINALIZED_AT + 7_200_000;
const ADDRESSES = {
  productionEmail: "producer@example.invalid",
  signerEmail: "signer@example.invalid",
};

function key(seed = 0): Uint8Array {
  return Uint8Array.from({ length: 32 }, (_, index) => (index + seed) % 256);
}

async function input(
  transactionId: string,
  overrides: Partial<CreateReleaseStateInput> = {},
): Promise<CreateReleaseStateInput> {
  return {
    transactionId,
    documentHash: "a".repeat(64),
    workflowVersion: "test-v1",
    finalizedAt: FINALIZED_AT,
    documentSize: 4,
    r2ObjectKey: `temporary/${transactionId}.pdf`,
    statusCapabilityHash: await sha256Hex(
      new TextEncoder().encode(`${transactionId}:status`),
    ),
    downloadCapabilityHash: await sha256Hex(
      new TextEncoder().encode(`${transactionId}:download`),
    ),
    emailAddresses: ADDRESSES,
    keyVersion: "kek-v1",
    keyEncryptionKey: key(),
    encryptedPdf: {
      metadata: {
        version: 1,
        keyVersion: "kek-v1",
        documentIv: "AAAAAAAAAAAAAAAA",
        wrappedKeyIv: "AQEBAQEBAQEBAQEB",
        wrappedKey: "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC",
        plaintextBytes: 4,
      },
      ciphertextSize: 20,
      ciphertextHash: "b".repeat(64),
    },
    ...overrides,
  };
}

describe("encrypted release-state creation", () => {
  it("atomically stores a decryptable envelope and two initial attempts", async () => {
    const transactionId = "transaction_state_encrypted";
    const releaseInput = await input(transactionId);

    await expect(createReleaseState(env.TEST_DB, releaseInput)).resolves.toEqual({
      transactionId,
      expiresAt: EXPIRES_AT,
    });
    await expect(loadTemporaryEmailAddresses(
      env.TEST_DB,
      transactionId,
      { "kek-v1": key() },
      FINALIZED_AT,
    )).resolves.toEqual(ADDRESSES);

    const stored = await env.TEST_DB.prepare(`
      SELECT * FROM temporary_releases WHERE transaction_id = ?
    `).bind(transactionId).first<Record<string, unknown>>();
    const serialized = JSON.stringify(stored);
    expect(serialized).not.toContain(ADDRESSES.productionEmail);
    expect(serialized).not.toContain(ADDRESSES.signerEmail);
    expect(stored).toMatchObject({
      envelope_version: 1,
      key_version: "kek-v1",
      storage_format: "ENCRYPTED_V1",
      pdf_envelope_version: 1,
      expires_at: EXPIRES_AT,
      cleanup_started_at: null,
    });
    expect(await env.TEST_DB.prepare(`
      SELECT release_state FROM audit_releases WHERE transaction_id = ?
    `).bind(transactionId).first()).toEqual({ release_state: "FINALIZING" });
    expect(await env.TEST_DB.prepare(`
      SELECT recipient_role, attempt_number, delivery_state
      FROM delivery_attempts WHERE transaction_id = ? ORDER BY recipient_role
    `).bind(transactionId).all()).toMatchObject({ results: [
      { recipient_role: "PRODUCTION", attempt_number: 1, delivery_state: "PENDING_SUBMISSION" },
      { recipient_role: "SIGNER", attempt_number: 1, delivery_state: "PENDING_SUBMISSION" },
    ] });
  });

  it("loads rows encrypted under different retained key versions", async () => {
    const firstId = "transaction_state_key_v1";
    const secondId = "transaction_state_key_v2";
    await createReleaseState(env.TEST_DB, await input(firstId));
    await createReleaseState(env.TEST_DB, await input(secondId, {
      keyVersion: "kek-v2",
      keyEncryptionKey: key(10),
    }));
    const keyring = { "kek-v1": key(), "kek-v2": key(10) };

    await expect(loadTemporaryEmailAddresses(
      env.TEST_DB, firstId, keyring, FINALIZED_AT,
    )).resolves.toEqual(ADDRESSES);
    await expect(loadTemporaryEmailAddresses(
      env.TEST_DB, secondId, keyring, FINALIZED_AT,
    )).resolves.toEqual(ADDRESSES);
    await expect(loadTemporaryEmailAddresses(
      env.TEST_DB, firstId, { "kek-v2": key(10) }, FINALIZED_AT,
    )).rejects.toThrow("Required key-encryption-key version is unavailable");
  });

  it("refuses to decrypt once cleanup starts or the release expires", async () => {
    const cleanupId = "transaction_state_cleanup_guard";
    const expiryId = "transaction_state_expiry_guard";
    await createReleaseState(env.TEST_DB, await input(cleanupId));
    await createReleaseState(env.TEST_DB, await input(expiryId));
    await env.TEST_DB.prepare(`
      UPDATE temporary_releases SET cleanup_started_at = ? WHERE transaction_id = ?
    `).bind(FINALIZED_AT + 1, cleanupId).run();

    await expect(loadTemporaryEmailAddresses(
      env.TEST_DB, cleanupId, { "kek-v1": key() }, FINALIZED_AT + 1,
    )).resolves.toBeNull();
    await expect(loadTemporaryEmailAddresses(
      env.TEST_DB, expiryId, { "kek-v1": key() }, EXPIRES_AT,
    )).resolves.toBeNull();
  });

  it("rolls back every D1 row when one release-state insert fails", async () => {
    const sourceId = "transaction_state_atomic_source";
    const failedId = "transaction_state_atomic_failed";
    const source = await input(sourceId);
    await createReleaseState(env.TEST_DB, source);

    await expect(createReleaseState(env.TEST_DB, await input(failedId, {
      r2ObjectKey: source.r2ObjectKey,
    }))).rejects.toThrow();

    for (const table of ["audit_releases", "temporary_releases", "delivery_attempts"]) {
      const row = await env.TEST_DB.prepare(`
        SELECT COUNT(*) AS count FROM ${table} WHERE transaction_id = ?
      `).bind(failedId).first<{ count: number }>();
      expect(row?.count).toBe(0);
    }
  });
});
