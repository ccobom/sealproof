import type { DeliveryEvent, DeliveryState, ReleaseDeliveryState } from "./state";

export interface VerifiedDeliveryEvent {
  svixId: string;
  payloadHash: string;
  providerMessageId: string;
  eventType: DeliveryEvent;
  providerEventAt: number;
  receivedAt: number;
}

export type ApplyVerifiedEventResult =
  | {
      outcome: "applied" | "duplicate";
      transactionId: string;
      recipientRole: "PRODUCTION" | "SIGNER";
      deliveryState: DeliveryState;
      releaseState: ReleaseDeliveryState;
    }
  | { outcome: "unknown_attempt" };

interface ReceiptRow {
  payload_hash: string;
}

interface BatchRow {
  transaction_id?: string;
  recipient_role?: "PRODUCTION" | "SIGNER";
  delivery_state?: DeliveryState;
  release_state?: ReleaseDeliveryState;
}

const EVENT_TYPES = new Set<DeliveryEvent>([
  "email.sent",
  "email.delivery_delayed",
  "email.delivered",
  "email.failed",
  "email.bounced",
]);

const NEXT_DELIVERY_STATE_SQL = `
  CASE
    WHEN delivery_state = 'UNRESOLVED_CONFLICT' THEN delivery_state
    WHEN ? = 'email.delivered' AND delivery_state = 'FAILED'
      THEN 'UNRESOLVED_CONFLICT'
    WHEN ? = 'email.delivered' THEN 'DELIVERED'
    WHEN ? IN ('email.failed', 'email.bounced') AND delivery_state = 'DELIVERED'
      THEN 'UNRESOLVED_CONFLICT'
    WHEN ? IN ('email.failed', 'email.bounced') THEN 'FAILED'
    WHEN delivery_state IN ('DELIVERED', 'FAILED') THEN delivery_state
    WHEN ? = 'email.delivery_delayed' THEN 'DELAYED'
    WHEN ? = 'email.sent' AND delivery_state = 'PENDING_SUBMISSION' THEN 'ACCEPTED'
    ELSE delivery_state
  END
`;

function assertEvent(input: VerifiedDeliveryEvent): void {
  if (input.svixId.length < 1 || input.svixId.length > 128) {
    throw new Error("svixId must contain between 1 and 128 characters");
  }
  if (!/^[0-9a-f]{64}$/.test(input.payloadHash)) {
    throw new Error("payloadHash must be a lowercase SHA-256 hex digest");
  }
  if (input.providerMessageId.length < 1) {
    throw new Error("providerMessageId is required");
  }
  if (!EVENT_TYPES.has(input.eventType)) {
    throw new Error("Unsupported delivery event type");
  }
  for (const [name, value] of [
    ["providerEventAt", input.providerEventAt],
    ["receivedAt", input.receivedAt],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${name} must be a non-negative safe integer`);
    }
  }
}

export async function applyVerifiedDeliveryEvent(
  db: D1Database,
  input: VerifiedDeliveryEvent,
): Promise<ApplyVerifiedEventResult> {
  assertEvent(input);

  const receipt = db.prepare(`
    INSERT OR IGNORE INTO processed_webhooks (
      svix_id, payload_hash, transaction_id, delivery_attempt_id, event_type, received_at
    )
    SELECT ?, ?, da.transaction_id, da.id, ?, ?
    FROM delivery_attempts da
    JOIN audit_releases ar ON ar.transaction_id = da.transaction_id
    WHERE da.provider_message_id = ? AND ar.release_state != 'FINALIZING'
  `).bind(
    input.svixId,
    input.payloadHash,
    input.eventType,
    input.receivedAt,
    input.providerMessageId,
  );

  const updateAttempt = db.prepare(`
    UPDATE delivery_attempts
    SET
      delivery_state = ${NEXT_DELIVERY_STATE_SQL},
      provider_event_at = CASE
        WHEN provider_event_at IS NULL OR provider_event_at < ? THEN ?
        ELSE provider_event_at
      END
    WHERE provider_message_id = ?
      AND EXISTS (
        SELECT 1 FROM audit_releases ar
        WHERE ar.transaction_id = delivery_attempts.transaction_id
          AND ar.release_state != 'FINALIZING'
      )
      AND EXISTS (
        SELECT 1 FROM processed_webhooks
        WHERE svix_id = ? AND payload_hash = ?
      )
    RETURNING transaction_id, recipient_role, delivery_state
  `).bind(
    input.eventType,
    input.eventType,
    input.eventType,
    input.eventType,
    input.eventType,
    input.eventType,
    input.providerEventAt,
    input.providerEventAt,
    input.providerMessageId,
    input.svixId,
    input.payloadHash,
  );

  const recomputeOutcomes = db.prepare(`
    WITH ranked AS (
      SELECT transaction_id, recipient_role, delivery_state,
        ROW_NUMBER() OVER (
          PARTITION BY transaction_id, recipient_role
          ORDER BY attempt_number DESC
        ) AS rank
      FROM delivery_attempts
      WHERE transaction_id = (
        SELECT transaction_id FROM delivery_attempts WHERE provider_message_id = ?
      )
    ), latest AS (
      SELECT transaction_id,
        MAX(CASE WHEN recipient_role = 'PRODUCTION' THEN delivery_state END) AS production_state,
        MAX(CASE WHEN recipient_role = 'SIGNER' THEN delivery_state END) AS signer_state
      FROM ranked WHERE rank = 1 GROUP BY transaction_id
    )
    UPDATE audit_releases
    SET
      production_delivery_outcome = CASE (SELECT production_state FROM latest)
        WHEN 'DELIVERED' THEN 'DELIVERED'
        WHEN 'FAILED' THEN 'FAILED'
        WHEN 'UNRESOLVED_CONFLICT' THEN 'UNRESOLVED'
        ELSE 'PENDING'
      END,
      signer_delivery_outcome = CASE (SELECT signer_state FROM latest)
        WHEN 'DELIVERED' THEN 'DELIVERED'
        WHEN 'FAILED' THEN 'FAILED'
        WHEN 'UNRESOLVED_CONFLICT' THEN 'UNRESOLVED'
        ELSE 'PENDING'
      END
    WHERE transaction_id = (SELECT transaction_id FROM latest)
      AND EXISTS (
        SELECT 1 FROM processed_webhooks WHERE svix_id = ? AND payload_hash = ?
      )
  `).bind(input.providerMessageId, input.svixId, input.payloadHash);

  const recomputeRelease = db.prepare(`
    UPDATE audit_releases
    SET release_state = CASE
      WHEN production_delivery_outcome = 'UNRESOLVED'
        OR signer_delivery_outcome = 'UNRESOLVED' THEN 'DELIVERY_UNRESOLVED'
      WHEN production_delivery_outcome = 'DELIVERED'
        AND signer_delivery_outcome = 'DELIVERED' THEN 'DELIVERED'
      WHEN production_delivery_outcome = 'FAILED'
        OR signer_delivery_outcome = 'FAILED' THEN 'DELIVERY_FAILED'
      ELSE 'SEALED_AWAITING_DELIVERY'
    END
    WHERE transaction_id = (
      SELECT transaction_id FROM delivery_attempts WHERE provider_message_id = ?
    )
      AND EXISTS (
        SELECT 1 FROM processed_webhooks WHERE svix_id = ? AND payload_hash = ?
      )
    RETURNING release_state
  `).bind(input.providerMessageId, input.svixId, input.payloadHash);

  const results = await db.batch<BatchRow>([
    receipt,
    updateAttempt,
    recomputeOutcomes,
    recomputeRelease,
  ]);

  const inserted = results[0]?.meta.changes === 1;
  const updated = results[1]?.results[0];
  const release = results[3]?.results[0];

  if (!updated || !release) {
    const existing = await db.prepare(`
      SELECT payload_hash FROM processed_webhooks WHERE svix_id = ?
    `).bind(input.svixId).first<ReceiptRow>();

    if (existing && existing.payload_hash !== input.payloadHash) {
      throw new Error("Webhook identifier was reused with a different payload");
    }
    return { outcome: "unknown_attempt" };
  }

  if (!updated.transaction_id || !updated.recipient_role || !updated.delivery_state
    || !release.release_state) {
    throw new Error("Webhook transaction returned an incomplete state");
  }

  return {
    outcome: inserted ? "applied" : "duplicate",
    transactionId: updated.transaction_id,
    recipientRole: updated.recipient_role,
    deliveryState: updated.delivery_state,
    releaseState: release.release_state,
  };
}
