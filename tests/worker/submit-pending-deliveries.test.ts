import { env } from "cloudflare:workers";
import { PDFDocument } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import type { DeliveryProvider } from "../../src/delivery/delivery-provider";
import { FakeDeliveryProvider } from "../../src/delivery/fake-delivery-provider";
import { submitPendingDeliveries } from "../../src/delivery/submit-pending-deliveries";
import {
  decryptProviderCapabilityFromStorage,
  encryptProviderCapabilityForStorage,
} from "../../src/delivery/provider-ticket-storage";
import { sha256Hex } from "../../src/document/hash";
import { handleProviderAttachmentRequest } from "../../src/http/provider-attachment-route";
import { finalizeRelease } from "../../src/release/finalize-release";

const NOW = 1_800_000_000_000;
const PDF_KEY = Uint8Array.from({ length: 32 }, (_, index) => index);
const PROVIDER_KEY = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
let PDF_BYTES: Uint8Array;

function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

beforeAll(async () => {
  const document = await PDFDocument.create();
  document.addPage();
  PDF_BYTES = await document.save();
});

async function release() {
  const result = await finalizeRelease(env.TEST_DB, env.TEST_BUCKET, {
    pdfBytes: PDF_BYTES,
    browserDocumentHash: await sha256Hex(PDF_BYTES),
    workflowVersion: "fake-provider-v1",
    emailAddresses: {
      productionEmail: "producer@example.invalid",
      signerEmail: "signer@example.invalid",
    },
    keyVersion: "pdf-v1",
    keyEncryptionKey: PDF_KEY,
  }, () => NOW);
  if (result.outcome !== "sealed") throw new Error("Could not create fixture");
  return result;
}

function attachmentEnvironment() {
  return {
    RELEASE_DB: env.TEST_DB,
    RELEASE_DOCUMENTS: env.TEST_BUCKET,
    EXPECTED_HOSTNAME: "sealproof.example",
    ACTIVE_KEY_VERSION: "pdf-v1",
    KEY_ENCRYPTION_KEY_BASE64: base64(PDF_KEY),
    ACTIVE_PROVIDER_ATTACHMENT_KEY_VERSION: "provider-v1",
    PROVIDER_ATTACHMENT_KEYS_JSON: JSON.stringify({ "provider-v1": base64(PROVIDER_KEY) }),
  };
}

function dependencies(provider: DeliveryProvider) {
  return {
    provider,
    keyEncryptionKeys: { "pdf-v1": PDF_KEY },
    providerAttachmentKeyVersion: "provider-v1",
    providerAttachmentKeys: { "provider-v1": PROVIDER_KEY },
    publicOrigin: "https://sealproof.example",
  };
}

describe("pending delivery submission coordinator", () => {
  it("encrypts the stored bearer and binds it to exactly one attempt", async () => {
    const ticket = "v1.provider-v1.synthetic-ticket-ciphertext";
    const envelope = await encryptProviderCapabilityForStorage(
      ticket, "provider-v1", PROVIDER_KEY, "transaction_storage_test", 42,
    );
    expect(envelope).not.toContain(ticket);
    await expect(decryptProviderCapabilityFromStorage(
      envelope, { "provider-v1": PROVIDER_KEY }, "transaction_storage_test", 42,
    )).resolves.toBe(ticket);
    await expect(decryptProviderCapabilityFromStorage(
      envelope, { "provider-v1": PROVIDER_KEY }, "transaction_storage_test", 43,
    )).rejects.toThrow();
    const altered = envelope.slice(0, -1) + (envelope.endsWith("A") ? "B" : "A");
    await expect(decryptProviderCapabilityFromStorage(
      altered, { "provider-v1": PROVIDER_KEY }, "transaction_storage_test", 42,
    )).rejects.toThrow();
  });

  it("submits two role-specific messages whose fetched attachments are exact matches", async () => {
    const sealed = await release();
    const attachmentUrls: string[] = [];
    const provider = new FakeDeliveryProvider((request) => {
      attachmentUrls.push(request.url);
      return handleProviderAttachmentRequest(request, attachmentEnvironment(), NOW + 1);
    });

    await expect(submitPendingDeliveries(
      env.TEST_DB, sealed.transactionId, dependencies(provider), NOW + 1,
    )).resolves.toEqual({
      submitted: ["PRODUCTION", "SIGNER"],
      alreadySubmitted: [],
      failed: [],
    });
    expect(provider.evidence).toHaveLength(2);
    expect(provider.evidence.map((item) => item.recipientRole)).toEqual(["PRODUCTION", "SIGNER"]);
    expect(new Set(provider.evidence.map((item) => item.documentHash))).toEqual(
      new Set([sealed.documentHash]),
    );
    expect(provider.evidence.every((item) => item.attachmentBytes === PDF_BYTES.byteLength)).toBe(true);
    expect(new Set(attachmentUrls).size).toBe(2);

    const attempts = await env.TEST_DB.prepare(`
      SELECT recipient_role, delivery_state, provider_message_id, provider_event_at
      FROM delivery_attempts WHERE transaction_id = ? ORDER BY id
    `).bind(sealed.transactionId).all<Record<string, unknown>>();
    expect(attempts.results).toEqual([
      expect.objectContaining({ recipient_role: "PRODUCTION", delivery_state: "ACCEPTED", provider_event_at: null }),
      expect.objectContaining({ recipient_role: "SIGNER", delivery_state: "ACCEPTED", provider_event_at: null }),
    ]);
    expect(new Set(attempts.results.map((item) => item.provider_message_id)).size).toBe(2);

    await expect(submitPendingDeliveries(
      env.TEST_DB, sealed.transactionId, dependencies(provider), NOW + 2,
    )).resolves.toEqual({
      submitted: [],
      alreadySubmitted: ["PRODUCTION", "SIGNER"],
      failed: [],
    });
    expect(provider.evidence).toHaveLength(2);
    expect(attachmentUrls).toHaveLength(2);

    await env.TEST_DB.prepare(`
      UPDATE delivery_attempts SET provider_message_id = NULL, delivery_state = 'PENDING_SUBMISSION'
      WHERE transaction_id = ? AND recipient_role = 'PRODUCTION'
    `).bind(sealed.transactionId).run();
    await expect(submitPendingDeliveries(
      env.TEST_DB, sealed.transactionId, dependencies(provider), NOW + 3,
    )).resolves.toEqual({
      submitted: ["PRODUCTION"],
      alreadySubmitted: ["SIGNER"],
      failed: [],
    });
    expect(provider.evidence).toHaveLength(2);
    expect(attachmentUrls).toHaveLength(2);
  });

  it("keeps a failed role pending without preventing the other role's acceptance", async () => {
    const sealed = await release();
    const exactProvider = new FakeDeliveryProvider((request) =>
      handleProviderAttachmentRequest(request, attachmentEnvironment(), NOW + 1));
    const provider: DeliveryProvider = {
      submit: (input) => input.recipientRole === "PRODUCTION"
        ? Promise.reject(new Error("synthetic rejection"))
        : exactProvider.submit(input),
    };

    await expect(submitPendingDeliveries(
      env.TEST_DB, sealed.transactionId, dependencies(provider), NOW + 1,
    )).resolves.toEqual({
      submitted: ["SIGNER"],
      alreadySubmitted: [],
      failed: ["PRODUCTION"],
    });
    const attempts = await env.TEST_DB.prepare(`
      SELECT recipient_role, delivery_state, provider_message_id
      FROM delivery_attempts WHERE transaction_id = ? ORDER BY id
    `).bind(sealed.transactionId).all<Record<string, unknown>>();
    expect(attempts.results).toEqual([
      { recipient_role: "PRODUCTION", delivery_state: "PENDING_SUBMISSION", provider_message_id: null },
      expect.objectContaining({ recipient_role: "SIGNER", delivery_state: "ACCEPTED" }),
    ]);
    expect(await env.TEST_DB.prepare(`
      SELECT submission_failure_category, submission_failed_at
      FROM delivery_attempts
      WHERE transaction_id = ? AND recipient_role = 'PRODUCTION'
    `).bind(sealed.transactionId).first()).toEqual({
      submission_failure_category: "provider_submission_failed",
      submission_failed_at: NOW + 1,
    });
  });

  it("submits nothing after the immutable release expiry", async () => {
    const sealed = await release();
    const provider = new FakeDeliveryProvider(() => {
      throw new Error("attachment fetch must not occur");
    });
    await expect(submitPendingDeliveries(
      env.TEST_DB, sealed.transactionId, dependencies(provider), sealed.expiresAt,
    )).resolves.toEqual({ submitted: [], alreadySubmitted: [], failed: [] });
    expect(provider.evidence).toHaveLength(0);
  });
});
