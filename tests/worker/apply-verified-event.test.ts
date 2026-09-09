import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  applyVerifiedDeliveryEvent,
  type VerifiedDeliveryEvent,
} from "../../src/delivery/apply-verified-event";
import { sha256Hex } from "../../src/document/hash";

const NOW = 1_800_000_000_000;
const DOCUMENT_HASH = "a".repeat(64);

async function createRelease(transactionId: string): Promise<void> {
  const statusHash = await sha256Hex(new TextEncoder().encode(`${transactionId}:status`));
  const downloadHash = await sha256Hex(new TextEncoder().encode(`${transactionId}:download`));
  await env.TEST_DB.batch([
    env.TEST_DB.prepare(`
      INSERT INTO audit_releases (
        transaction_id, document_hash, hash_algorithm, workflow_version,
        finalized_at, release_state
      ) VALUES (?, ?, 'SHA-256', 'test-v1', ?, 'SEALED_AWAITING_DELIVERY')
    `).bind(transactionId, DOCUMENT_HASH, NOW),
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
      NOW + 7_200_000,
    ),
    env.TEST_DB.prepare(`
      INSERT INTO delivery_attempts (
        transaction_id, recipient_role, attempt_number, provider_message_id,
        delivery_state, created_at
      ) VALUES (?, 'PRODUCTION', 1, ?, 'ACCEPTED', ?)
    `).bind(transactionId, `${transactionId}-production`, NOW),
    env.TEST_DB.prepare(`
      INSERT INTO delivery_attempts (
        transaction_id, recipient_role, attempt_number, provider_message_id,
        delivery_state, created_at
      ) VALUES (?, 'SIGNER', 1, ?, 'ACCEPTED', ?)
    `).bind(transactionId, `${transactionId}-signer`, NOW),
  ]);
}

function event(
  transactionId: string,
  overrides: Partial<VerifiedDeliveryEvent> = {},
): VerifiedDeliveryEvent {
  return {
    svixId: `${transactionId}-webhook`,
    payloadHash: "d".repeat(64),
    providerMessageId: `${transactionId}-production`,
    eventType: "email.delivered",
    providerEventAt: NOW + 1,
    receivedAt: NOW + 2,
    ...overrides,
  };
}

describe("applyVerifiedDeliveryEvent", () => {
  it("atomically records a verified event and updates its attempt and release", async () => {
    const transactionId = "transaction_webhook_apply";
    await createRelease(transactionId);

    const production = await applyVerifiedDeliveryEvent(env.TEST_DB, event(transactionId));
    const signer = await applyVerifiedDeliveryEvent(env.TEST_DB, event(transactionId, {
      svixId: `${transactionId}-signer-webhook`,
      payloadHash: "e".repeat(64),
      providerMessageId: `${transactionId}-signer`,
    }));

    expect(production).toMatchObject({
      outcome: "applied",
      deliveryState: "DELIVERED",
      releaseState: "SEALED_AWAITING_DELIVERY",
    });
    expect(signer).toMatchObject({
      outcome: "applied",
      deliveryState: "DELIVERED",
      releaseState: "DELIVERED",
    });

    const audit = await env.TEST_DB.prepare(`
      SELECT production_delivery_outcome, signer_delivery_outcome, release_state
      FROM audit_releases WHERE transaction_id = ?
    `).bind(transactionId).first();
    expect(audit).toEqual({
      production_delivery_outcome: "DELIVERED",
      signer_delivery_outcome: "DELIVERED",
      release_state: "DELIVERED",
    });
  });

  it("accepts the same webhook once and identifies the retry as a duplicate", async () => {
    const transactionId = "transaction_webhook_duplicate";
    await createRelease(transactionId);
    const input = event(transactionId);

    const [first, second] = await Promise.all([
      applyVerifiedDeliveryEvent(env.TEST_DB, input),
      applyVerifiedDeliveryEvent(env.TEST_DB, input),
    ]);

    expect([first.outcome, second.outcome].sort()).toEqual(["applied", "duplicate"]);
    const count = await env.TEST_DB.prepare(`
      SELECT COUNT(*) AS count FROM processed_webhooks WHERE svix_id = ?
    `).bind(input.svixId).first<{ count: number }>();
    expect(count?.count).toBe(1);
  });

  it("rejects a reused webhook identifier with a different payload", async () => {
    const transactionId = "transaction_webhook_collision";
    await createRelease(transactionId);
    const input = event(transactionId);
    await applyVerifiedDeliveryEvent(env.TEST_DB, input);

    await expect(applyVerifiedDeliveryEvent(env.TEST_DB, {
      ...input,
      payloadHash: "f".repeat(64),
      eventType: "email.failed",
    })).rejects.toThrow("Webhook identifier was reused with a different payload");

    const attempt = await env.TEST_DB.prepare(`
      SELECT delivery_state FROM delivery_attempts WHERE provider_message_id = ?
    `).bind(input.providerMessageId).first();
    expect(attempt).toEqual({ delivery_state: "DELIVERED" });
  });

  it("makes contradictory terminal events unresolved regardless of arrival order", async () => {
    for (const [suffix, first, second] of [
      ["delivered_first", "email.delivered", "email.bounced"],
      ["failed_first", "email.failed", "email.delivered"],
    ] as const) {
      const transactionId = `transaction_webhook_${suffix}`;
      await createRelease(transactionId);
      await applyVerifiedDeliveryEvent(env.TEST_DB, event(transactionId, {
        svixId: `${transactionId}-first`,
        eventType: first,
      }));
      const result = await applyVerifiedDeliveryEvent(env.TEST_DB, event(transactionId, {
        svixId: `${transactionId}-second`,
        payloadHash: "e".repeat(64),
        eventType: second,
      }));

      expect(result).toMatchObject({
        outcome: "applied",
        deliveryState: "UNRESOLVED_CONFLICT",
        releaseState: "DELIVERY_UNRESOLVED",
      });
    }
  });

  it("does not let a late nonterminal event downgrade a terminal state", async () => {
    const transactionId = "transaction_webhook_late_sent";
    await createRelease(transactionId);
    await applyVerifiedDeliveryEvent(env.TEST_DB, event(transactionId));

    const result = await applyVerifiedDeliveryEvent(env.TEST_DB, event(transactionId, {
      svixId: `${transactionId}-late`,
      payloadHash: "e".repeat(64),
      eventType: "email.sent",
      providerEventAt: NOW - 1,
    }));

    expect(result).toMatchObject({ deliveryState: "DELIVERED" });
    const attempt = await env.TEST_DB.prepare(`
      SELECT provider_event_at FROM delivery_attempts WHERE provider_message_id = ?
    `).bind(`${transactionId}-production`).first();
    expect(attempt).toEqual({ provider_event_at: NOW + 1 });
  });

  it("does not retain an event for an unknown provider message", async () => {
    const transactionId = "transaction_webhook_unknown";
    await createRelease(transactionId);
    const input = event(transactionId, { providerMessageId: "unknown-provider-id" });

    await expect(applyVerifiedDeliveryEvent(env.TEST_DB, input)).resolves.toEqual({
      outcome: "unknown_attempt",
    });
    const receipt = await env.TEST_DB.prepare(`
      SELECT COUNT(*) AS count FROM processed_webhooks WHERE svix_id = ?
    `).bind(input.svixId).first<{ count: number }>();
    expect(receipt?.count).toBe(0);
  });

  it("cannot use a delivery event to move a FINALIZING release", async () => {
    const transactionId = "transaction_webhook_finalizing";
    await createRelease(transactionId);
    await env.TEST_DB.prepare(`
      UPDATE audit_releases SET release_state = 'FINALIZING' WHERE transaction_id = ?
    `).bind(transactionId).run();
    const input = event(transactionId);

    await expect(applyVerifiedDeliveryEvent(env.TEST_DB, input)).resolves.toEqual({
      outcome: "unknown_attempt",
    });
    expect(await env.TEST_DB.prepare(`
      SELECT release_state FROM audit_releases WHERE transaction_id = ?
    `).bind(transactionId).first()).toEqual({ release_state: "FINALIZING" });
    expect(await env.TEST_DB.prepare(`
      SELECT COUNT(*) AS count FROM processed_webhooks WHERE svix_id = ?
    `).bind(input.svixId).first()).toEqual({ count: 0 });
  });
});
