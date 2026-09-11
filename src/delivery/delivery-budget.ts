// The current server-owned workflow always addresses these two recipients.
export const INITIAL_DELIVERY_ROLES = ["PRODUCTION", "SIGNER"] as const;

export async function deliveryAvailable(
  environment: { DELIVERY_ENABLED?: string; RELEASE_DB: D1Database },
  now: number,
  required: number = INITIAL_DELIVERY_ROLES.length,
): Promise<boolean> {
  if (!Number.isSafeInteger(now) || now < 0 || environment.DELIVERY_ENABLED !== "true") {
    return false;
  }
  try {
    const row = await environment.RELEASE_DB.prepare(`
      SELECT attempt_limit - COALESCE((
        SELECT SUM(attempts) FROM delivery_budget WHERE reserved_at > ?
      ), 0) AS remaining
      FROM delivery_budget_policy WHERE id = 1
    `).bind(now - 86_400_000).first<{ remaining: number }>();
    return !!row && row.remaining >= required;
  } catch {
    return false;
  }
}

export function budgetExhausted(error: unknown): boolean {
  return error instanceof Error && error.message.includes("DELIVERY_BUDGET_EXHAUSTED");
}
