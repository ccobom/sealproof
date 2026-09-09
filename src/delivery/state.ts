export type DeliveryState =
  | "PENDING_SUBMISSION"
  | "ACCEPTED"
  | "DELAYED"
  | "DELIVERED"
  | "FAILED"
  | "UNRESOLVED_CONFLICT";

export type DeliveryEvent =
  | "email.sent"
  | "email.delivery_delayed"
  | "email.delivered"
  | "email.failed"
  | "email.bounced";

export type ReleaseDeliveryState =
  | "SEALED_AWAITING_DELIVERY"
  | "DELIVERED"
  | "DELIVERY_FAILED"
  | "DELIVERY_UNRESOLVED";

export const MAXIMUM_TEMPORARY_RETENTION_MS = 2 * 60 * 60 * 1_000;
export const MAXIMUM_DELIVERY_ATTEMPTS_PER_ROLE = 3;

export function calculateExpiry(finalizedAt: number): number {
  if (!Number.isSafeInteger(finalizedAt) || finalizedAt < 0) {
    throw new Error("Finalization timestamp must be a non-negative safe integer");
  }
  return finalizedAt + MAXIMUM_TEMPORARY_RETENTION_MS;
}

export function isExpired(expiresAt: number, now: number): boolean {
  return now >= expiresAt;
}

export function deriveReleaseDeliveryState(
  production: DeliveryState,
  signer: DeliveryState,
): ReleaseDeliveryState {
  if (production === "UNRESOLVED_CONFLICT" || signer === "UNRESOLVED_CONFLICT") {
    return "DELIVERY_UNRESOLVED";
  }
  if (production === "DELIVERED" && signer === "DELIVERED") return "DELIVERED";
  if (production === "FAILED" || signer === "FAILED") return "DELIVERY_FAILED";
  return "SEALED_AWAITING_DELIVERY";
}

export function reduceDeliveryState(
  current: DeliveryState,
  event: DeliveryEvent,
): DeliveryState {
  if (current === "UNRESOLVED_CONFLICT") return current;

  if (event === "email.delivered") {
    return current === "FAILED" ? "UNRESOLVED_CONFLICT" : "DELIVERED";
  }
  if (event === "email.failed" || event === "email.bounced") {
    return current === "DELIVERED" ? "UNRESOLVED_CONFLICT" : "FAILED";
  }

  if (current === "DELIVERED" || current === "FAILED") return current;
  if (event === "email.delivery_delayed") return "DELAYED";
  if (event === "email.sent" && current === "PENDING_SUBMISSION") return "ACCEPTED";
  return current;
}
