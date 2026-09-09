export async function recomputeDeliverySummary(
  db: D1Database,
  transactionId: string,
): Promise<void> {
  await db.prepare(`
    WITH ranked AS (
      SELECT recipient_role, delivery_state,
        ROW_NUMBER() OVER (PARTITION BY recipient_role ORDER BY attempt_number DESC) AS rank
      FROM delivery_attempts WHERE transaction_id = ?
    ), latest AS (
      SELECT
        MAX(CASE WHEN recipient_role = 'PRODUCTION' AND rank = 1 THEN delivery_state END)
          AS production_state,
        MAX(CASE WHEN recipient_role = 'SIGNER' AND rank = 1 THEN delivery_state END)
          AS signer_state
      FROM ranked
    ), outcomes AS (
      SELECT
        CASE production_state
          WHEN 'DELIVERED' THEN 'DELIVERED'
          WHEN 'FAILED' THEN 'FAILED'
          WHEN 'UNRESOLVED_CONFLICT' THEN 'UNRESOLVED'
          ELSE 'PENDING'
        END AS production_outcome,
        CASE signer_state
          WHEN 'DELIVERED' THEN 'DELIVERED'
          WHEN 'FAILED' THEN 'FAILED'
          WHEN 'UNRESOLVED_CONFLICT' THEN 'UNRESOLVED'
          ELSE 'PENDING'
        END AS signer_outcome
      FROM latest
    )
    UPDATE audit_releases SET
      production_delivery_outcome = (SELECT production_outcome FROM outcomes),
      signer_delivery_outcome = (SELECT signer_outcome FROM outcomes),
      release_state = CASE
        WHEN (SELECT production_outcome FROM outcomes) = 'UNRESOLVED'
          OR (SELECT signer_outcome FROM outcomes) = 'UNRESOLVED' THEN 'DELIVERY_UNRESOLVED'
        WHEN (SELECT production_outcome FROM outcomes) = 'DELIVERED'
          AND (SELECT signer_outcome FROM outcomes) = 'DELIVERED' THEN 'DELIVERED'
        WHEN (SELECT production_outcome FROM outcomes) = 'FAILED'
          OR (SELECT signer_outcome FROM outcomes) = 'FAILED' THEN 'DELIVERY_FAILED'
        ELSE 'SEALED_AWAITING_DELIVERY'
      END,
      failure_category = CASE
        WHEN (SELECT production_outcome FROM outcomes) = 'UNRESOLVED'
          OR (SELECT signer_outcome FROM outcomes) = 'UNRESOLVED'
          THEN 'conflicting_provider_events'
        WHEN (SELECT production_outcome FROM outcomes) = 'FAILED'
          OR (SELECT signer_outcome FROM outcomes) = 'FAILED'
          THEN COALESCE(failure_category, 'unknown_failure')
        ELSE NULL
      END
    WHERE transaction_id = ? AND release_state != 'CLOSED'
  `).bind(transactionId, transactionId).run();
}
