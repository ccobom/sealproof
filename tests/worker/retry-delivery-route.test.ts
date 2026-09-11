import { env } from "cloudflare:workers";
import { PDFDocument } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { applyVerifiedDeliveryEvent } from "../../src/delivery/apply-verified-event";
import { sha256Hex } from "../../src/document/hash";
import { handleRetryDeliveryRequest } from "../../src/http/retry-delivery-route";
import { finalizeRelease } from "../../src/release/finalize-release";
import { runLocalFakeDelivery, runLocalFakeRetry } from "../../src/worker/local-app";
import type { SealProofEnvironment } from "../../src/worker/app";

const NOW = 1_800_000_000_000;
const PDF_KEY = Uint8Array.from({ length: 32 }, (_, index) => index);
let PDF_BYTES: Uint8Array;

function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

const ENVIRONMENT: SealProofEnvironment = {
  RELEASE_DB: env.TEST_DB,
  RELEASE_DOCUMENTS: env.TEST_BUCKET,
  TURNSTILE_SECRET_KEY: "synthetic",
  DELIVERY_ENABLED: "true",
  EXPECTED_HOSTNAME: "sealproof.example",
  ACTIVE_WORKFLOW_VERSION: "retry-v1",
  ACTIVE_KEY_VERSION: "pdf-v1",
  KEY_ENCRYPTION_KEY_BASE64: base64(PDF_KEY),
  ACTIVE_TICKET_KEY_VERSION: "ticket-v1",
  TICKET_ENCRYPTION_KEY_BASE64: base64(PDF_KEY),
};

beforeAll(async () => {
  const document = await PDFDocument.create();
  document.addPage();
  PDF_BYTES = await document.save();
});

async function failedRelease(productionEvent: "email.delivered" | "email.bounced" = "email.delivered") {
  const result = await finalizeRelease(env.TEST_DB, env.TEST_BUCKET, {
    pdfBytes: PDF_BYTES,
    browserDocumentHash: await sha256Hex(PDF_BYTES),
    workflowVersion: "retry-v1",
    emailAddresses: {
      productionEmail: "producer@example.invalid",
      signerEmail: "signer@example.invalid",
    },
    keyVersion: "pdf-v1",
    keyEncryptionKey: PDF_KEY,
  }, () => NOW);
  if (result.outcome !== "sealed") throw new Error("Could not create retry fixture");
  await runLocalFakeDelivery({
    transactionId: result.transactionId,
    publicOrigin: "https://sealproof.example",
    sealedAt: NOW + 1,
  }, ENVIRONMENT);
  const attempts = await env.TEST_DB.prepare(`
    SELECT recipient_role, provider_message_id FROM delivery_attempts
    WHERE transaction_id = ? ORDER BY id
  `).bind(result.transactionId).all<{
    recipient_role: "PRODUCTION" | "SIGNER";
    provider_message_id: string;
  }>();
  for (const attempt of attempts.results) {
    const eventType = attempt.recipient_role === "PRODUCTION"
      ? productionEvent
      : "email.bounced" as const;
    await applyVerifiedDeliveryEvent(env.TEST_DB, {
      svixId: `retry-fixture-${result.transactionId}-${attempt.recipient_role}`,
      payloadHash: await sha256Hex(new TextEncoder().encode(`${result.transactionId}:${eventType}`)),
      providerMessageId: attempt.provider_message_id,
      eventType,
      providerEventAt: NOW + 2,
      receivedAt: NOW + 2,
    });
  }
  return result;
}

function request(
  transactionId: string,
  capability: string,
  recipientRole: "PRODUCTION" | "SIGNER" = "SIGNER",
) {
  return new Request(`https://sealproof.example/api/releases/${transactionId}/retry`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${capability}`,
      "content-type": "application/json",
      origin: "https://sealproof.example",
    },
    body: JSON.stringify({ recipientRole }),
  });
}

async function bounceLatestSigner(transactionId: string, suffix: string, at: number) {
  const attempt = await env.TEST_DB.prepare(`
    SELECT provider_message_id FROM delivery_attempts
    WHERE transaction_id = ? AND recipient_role = 'SIGNER'
    ORDER BY attempt_number DESC LIMIT 1
  `).bind(transactionId).first<{ provider_message_id: string }>();
  await applyVerifiedDeliveryEvent(env.TEST_DB, {
    svixId: `retry-bounce-${transactionId}-${suffix}`,
    payloadHash: await sha256Hex(new TextEncoder().encode(`${transactionId}:${suffix}`)),
    providerMessageId: attempt!.provider_message_id,
    eventType: "email.bounced",
    providerEventAt: at,
    receivedAt: at,
  });
}

describe("delivery retry route", () => {
  it("submits one pending retry while the other recipient remains failed", async () => {
    const release = await failedRelease("email.bounced");
    const response = await handleRetryDeliveryRequest(
      request(release.transactionId, release.downloadCapability, "PRODUCTION"),
      ENVIRONMENT,
      NOW + 3,
      runLocalFakeRetry,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      outcome: "accepted",
      recipientRole: "PRODUCTION",
      attemptNumber: 2,
    });
    expect(await env.TEST_DB.prepare(`
      SELECT attempt_number, delivery_state FROM delivery_attempts
      WHERE transaction_id = ? AND recipient_role = 'PRODUCTION'
      ORDER BY attempt_number
    `).bind(release.transactionId).all()).toMatchObject({
      results: [
        { attempt_number: 1, delivery_state: "FAILED" },
        { attempt_number: 2, delivery_state: "ACCEPTED" },
      ],
    });
  });

  it("retries an unaccepted first attempt without consuming a retry", async () => {
    const release = await finalizeRelease(env.TEST_DB, env.TEST_BUCKET, {
      pdfBytes: PDF_BYTES,
      browserDocumentHash: await sha256Hex(PDF_BYTES),
      workflowVersion: "retry-v1",
      emailAddresses: {
        productionEmail: "producer@example.invalid",
        signerEmail: "signer@example.invalid",
      },
      keyVersion: "pdf-v1",
      keyEncryptionKey: PDF_KEY,
    }, () => NOW);
    if (release.outcome !== "sealed") throw new Error("Could not create pending fixture");

    const response = await handleRetryDeliveryRequest(
      request(release.transactionId, release.downloadCapability),
      ENVIRONMENT,
      NOW + 1,
      runLocalFakeRetry,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      outcome: "accepted",
      recipientRole: "SIGNER",
      attemptNumber: 1,
    });
    expect((await env.TEST_DB.prepare(`
      SELECT COUNT(*) AS count FROM delivery_attempts
      WHERE transaction_id = ? AND recipient_role = 'SIGNER'
    `).bind(release.transactionId).first<{ count: number }>())?.count).toBe(1);
  });

  it("creates one new role attempt while preserving the PDF identity and expiry", async () => {
    const release = await failedRelease();
    const before = await env.TEST_DB.prepare(`
      SELECT expires_at, r2_object_key FROM temporary_releases WHERE transaction_id = ?
    `).bind(release.transactionId).first<{ expires_at: number; r2_object_key: string }>();
    const response = await handleRetryDeliveryRequest(
      request(release.transactionId, release.downloadCapability),
      ENVIRONMENT,
      NOW + 3,
      runLocalFakeRetry,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      outcome: "accepted",
      recipientRole: "SIGNER",
      attemptNumber: 2,
    });
    const attempts = await env.TEST_DB.prepare(`
      SELECT attempt_number, delivery_state FROM delivery_attempts
      WHERE transaction_id = ? AND recipient_role = 'SIGNER' ORDER BY attempt_number
    `).bind(release.transactionId).all();
    expect(attempts.results).toEqual([
      { attempt_number: 1, delivery_state: "FAILED" },
      { attempt_number: 2, delivery_state: "ACCEPTED" },
    ]);
    expect(await env.TEST_DB.prepare(`
      SELECT release_state, production_delivery_outcome, signer_delivery_outcome,
        failure_category, document_hash
      FROM audit_releases WHERE transaction_id = ?
    `).bind(release.transactionId).first()).toEqual({
      release_state: "SEALED_AWAITING_DELIVERY",
      production_delivery_outcome: "DELIVERED",
      signer_delivery_outcome: "PENDING",
      failure_category: null,
      document_hash: release.documentHash,
    });
    expect(await env.TEST_DB.prepare(`
      SELECT expires_at, r2_object_key FROM temporary_releases WHERE transaction_id = ?
    `).bind(release.transactionId).first()).toEqual(before);

    const repeated = await handleRetryDeliveryRequest(
      request(release.transactionId, release.downloadCapability),
      ENVIRONMENT,
      NOW + 4,
      runLocalFakeRetry,
    );
    expect(repeated.status).toBe(200);
    expect((await repeated.json<{ attemptNumber: number }>()).attemptNumber).toBe(2);
    expect((await env.TEST_DB.prepare(`
      SELECT COUNT(*) AS count FROM delivery_attempts
      WHERE transaction_id = ? AND recipient_role = 'SIGNER'
    `).bind(release.transactionId).first<{ count: number }>())?.count).toBe(2);
  });

  it("conceals invalid authorization and refuses expiry", async () => {
    const release = await failedRelease();
    expect((await handleRetryDeliveryRequest(
      request(release.transactionId, "A".repeat(43)), ENVIRONMENT, NOW + 3, runLocalFakeRetry,
    )).status).toBe(404);
    expect((await handleRetryDeliveryRequest(
      request(release.transactionId, release.downloadCapability),
      ENVIRONMENT,
      release.expiresAt,
      runLocalFakeRetry,
    )).status).toBe(404);
    expect((await env.TEST_DB.prepare(`
      SELECT COUNT(*) AS count FROM delivery_attempts
      WHERE transaction_id = ? AND recipient_role = 'SIGNER'
    `).bind(release.transactionId).first<{ count: number }>())?.count).toBe(1);
  });

  it("recovers a pending retry instead of creating another attempt", async () => {
    const release = await failedRelease();
    const first = await handleRetryDeliveryRequest(
      request(release.transactionId, release.downloadCapability),
      ENVIRONMENT,
      NOW + 3,
      async () => { throw new Error("synthetic provider interruption"); },
    );
    expect(first.status).toBe(202);
    expect(await first.json()).toEqual({
      outcome: "pending",
      recipientRole: "SIGNER",
      attemptNumber: 2,
    });

    const recovered = await handleRetryDeliveryRequest(
      request(release.transactionId, release.downloadCapability),
      ENVIRONMENT,
      NOW + 4,
      runLocalFakeRetry,
    );
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toEqual({
      outcome: "accepted",
      recipientRole: "SIGNER",
      attemptNumber: 2,
    });
    const attempts = await env.TEST_DB.prepare(`
      SELECT attempt_number, delivery_state FROM delivery_attempts
      WHERE transaction_id = ? AND recipient_role = 'SIGNER' ORDER BY attempt_number
    `).bind(release.transactionId).all();
    expect(attempts.results).toEqual([
      { attempt_number: 1, delivery_state: "FAILED" },
      { attempt_number: 2, delivery_state: "ACCEPTED" },
    ]);
  });

  it("allows only two retries per recipient role", async () => {
    const release = await failedRelease();
    const retry = (at: number) => handleRetryDeliveryRequest(
      request(release.transactionId, release.downloadCapability),
      ENVIRONMENT,
      at,
      runLocalFakeRetry,
    );
    expect((await retry(NOW + 3)).status).toBe(200);
    await bounceLatestSigner(release.transactionId, "second", NOW + 4);
    expect((await retry(NOW + 5)).status).toBe(200);
    await bounceLatestSigner(release.transactionId, "third", NOW + 6);
    const exhausted = await retry(NOW + 7);
    expect(exhausted.status).toBe(409);
    expect(await exhausted.json()).toEqual({ error: "RETRY_LIMIT_REACHED" });
    expect((await env.TEST_DB.prepare(`
      SELECT COUNT(*) AS count FROM delivery_attempts
      WHERE transaction_id = ? AND recipient_role = 'SIGNER'
    `).bind(release.transactionId).first<{ count: number }>())?.count).toBe(3);
  });
});
