import { env } from "cloudflare:workers";
import { Webhook } from "svix";
import { describe, expect, it } from "vitest";
import { processResendWebhookRequest } from "../../src/delivery/process-resend-webhook";
import {
  ResendWebhookError,
  verifyResendWebhook,
} from "../../src/delivery/verify-resend-webhook";
import { sha256Hex } from "../../src/document/hash";

const SECRET = "whsec_c2VhbHByb29mLWxvY2FsLXRlc3Qtc2VjcmV0";
const WRONG_SECRET = "whsec_d3JvbmctbG9jYWwtdGVzdC1zZWNyZXQ=";
const RECEIVED_AT = 1_800_000_000_000;

function body(type = "email.delivered", emailId = "provider-message-1"): string {
  return JSON.stringify({
    type,
    created_at: "2027-01-15T08:00:00.000Z",
    data: {
      email_id: emailId,
      to: ["synthetic@example.invalid"],
      subject: "Synthetic test",
    },
  });
}

function signedHeaders(rawBody: string, options: {
  id?: string;
  secret?: string;
  timestamp?: Date;
} = {}): Headers {
  const id = options.id ?? "webhook-local-1";
  const secret = options.secret ?? SECRET;
  const timestamp = options.timestamp ?? new Date();
  return new Headers({
    "svix-id": id,
    "svix-timestamp": String(Math.floor(timestamp.getTime() / 1_000)),
    "svix-signature": new Webhook(secret).sign(id, timestamp, rawBody),
  });
}

async function createRelease(transactionId: string, providerMessageId: string): Promise<void> {
  const statusHash = await sha256Hex(new TextEncoder().encode(`${transactionId}:status`));
  const downloadHash = await sha256Hex(new TextEncoder().encode(`${transactionId}:download`));
  await env.TEST_DB.batch([
    env.TEST_DB.prepare(`
      INSERT INTO audit_releases (
        transaction_id, document_hash, hash_algorithm, workflow_version,
        finalized_at, release_state
      ) VALUES (?, ?, 'SHA-256', 'test-v1', ?, 'SEALED_AWAITING_DELIVERY')
    `).bind(transactionId, "a".repeat(64), RECEIVED_AT),
    env.TEST_DB.prepare(`
      INSERT INTO temporary_releases (
        transaction_id, envelope_version, key_version, envelope_iv,
        email_ciphertext, wrapped_key_iv, wrapped_data_key, document_size, r2_object_key,
        status_capability_hash, download_capability_hash, expires_at
      ) VALUES (?, 1, 'v1', 'iv', 'ciphertext', 'key-iv', 'wrapped-key', 4, ?, ?, ?, ?)
    `).bind(
      transactionId,
      `synthetic/${transactionId}.pdf`,
      statusHash,
      downloadHash,
      RECEIVED_AT + 7_200_000,
    ),
    env.TEST_DB.prepare(`
      INSERT INTO delivery_attempts (
        transaction_id, recipient_role, attempt_number, provider_message_id,
        delivery_state, created_at
      ) VALUES (?, 'PRODUCTION', 1, ?, 'ACCEPTED', ?)
    `).bind(transactionId, providerMessageId, RECEIVED_AT),
    env.TEST_DB.prepare(`
      INSERT INTO delivery_attempts (
        transaction_id, recipient_role, attempt_number, provider_message_id,
        delivery_state, created_at
      ) VALUES (?, 'SIGNER', 1, ?, 'ACCEPTED', ?)
    `).bind(transactionId, `${providerMessageId}-signer`, RECEIVED_AT),
  ]);
}

describe("Resend webhook verification", () => {
  it("verifies the raw signed body and returns only normalized fields", async () => {
    const rawBody = body();
    const verified = await verifyResendWebhook(
      rawBody,
      signedHeaders(rawBody),
      SECRET,
      RECEIVED_AT,
    );

    expect(verified).toEqual({
      svixId: "webhook-local-1",
      payloadHash: await sha256Hex(new TextEncoder().encode(rawBody)),
      providerMessageId: "provider-message-1",
      eventType: "email.delivered",
      providerEventAt: Date.parse("2027-01-15T08:00:00.000Z"),
      receivedAt: RECEIVED_AT,
    });
    expect(JSON.stringify(verified)).not.toContain("synthetic@example.invalid");
  });

  it("rejects a body changed after signing", async () => {
    const signedBody = body("email.delivered");
    const changedBody = body("email.failed");
    await expect(verifyResendWebhook(
      changedBody,
      signedHeaders(signedBody),
      SECRET,
      RECEIVED_AT,
    )).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
  });

  it("rejects a signature made with a different secret", async () => {
    const rawBody = body();
    await expect(verifyResendWebhook(
      rawBody,
      signedHeaders(rawBody, { secret: WRONG_SECRET }),
      SECRET,
      RECEIVED_AT,
    )).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
  });

  it("rejects missing signature headers", async () => {
    await expect(verifyResendWebhook(
      body(),
      new Headers(),
      SECRET,
      RECEIVED_AT,
    )).rejects.toMatchObject({ code: "MISSING_HEADERS" });
  });

  it("rejects a correctly signed but stale request", async () => {
    const rawBody = body();
    await expect(verifyResendWebhook(
      rawBody,
      signedHeaders(rawBody, { timestamp: new Date(Date.now() - 10 * 60 * 1_000) }),
      SECRET,
      RECEIVED_AT,
    )).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
  });

  it("rejects signed unsupported and malformed events", async () => {
    const unsupported = body("email.opened");
    await expect(verifyResendWebhook(
      unsupported,
      signedHeaders(unsupported),
      SECRET,
      RECEIVED_AT,
    )).rejects.toMatchObject({ code: "UNSUPPORTED_EVENT" });

    const malformed = JSON.stringify({
      type: "email.delivered",
      created_at: "not-a-date",
      data: {},
    });
    await expect(verifyResendWebhook(
      malformed,
      signedHeaders(malformed),
      SECRET,
      RECEIVED_AT,
    )).rejects.toMatchObject({ code: "MALFORMED_PAYLOAD" });
  });

  it("verifies before applying the event to D1", async () => {
    const transactionId = "transaction_verified_pipeline";
    const providerMessageId = "provider-verified-pipeline";
    await createRelease(transactionId, providerMessageId);
    const rawBody = body("email.delivered", providerMessageId);

    const invalidRequest = new Request("https://sealproof.invalid/webhooks/resend", {
      method: "POST",
      headers: signedHeaders(rawBody, { secret: WRONG_SECRET }),
      body: rawBody,
    });
    await expect(processResendWebhookRequest(
      env.TEST_DB,
      invalidRequest,
      SECRET,
      RECEIVED_AT,
    )).rejects.toBeInstanceOf(ResendWebhookError);

    const before = await env.TEST_DB.prepare(`
      SELECT delivery_state FROM delivery_attempts WHERE provider_message_id = ?
    `).bind(providerMessageId).first();
    expect(before).toEqual({ delivery_state: "ACCEPTED" });

    const validRequest = new Request("https://sealproof.invalid/webhooks/resend", {
      method: "POST",
      headers: signedHeaders(rawBody),
      body: rawBody,
    });
    const result = await processResendWebhookRequest(
      env.TEST_DB,
      validRequest,
      SECRET,
      RECEIVED_AT,
    );
    expect(result).toMatchObject({ outcome: "applied", deliveryState: "DELIVERED" });
  });
});
