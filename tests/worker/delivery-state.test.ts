import { describe, expect, it } from "vitest";
import {
  calculateExpiry,
  deriveReleaseDeliveryState,
  isExpired,
  reduceDeliveryState,
} from "../../src/delivery/state";

describe("delivery state", () => {
  it("does not allow late non-terminal events to move terminal states backward", () => {
    expect(reduceDeliveryState("DELIVERED", "email.sent")).toBe("DELIVERED");
    expect(reduceDeliveryState("DELIVERED", "email.delivery_delayed")).toBe("DELIVERED");
    expect(reduceDeliveryState("FAILED", "email.sent")).toBe("FAILED");
  });

  it("marks either order of contradictory terminal events unresolved", () => {
    expect(reduceDeliveryState("DELIVERED", "email.bounced")).toBe("UNRESOLVED_CONFLICT");
    expect(reduceDeliveryState("FAILED", "email.delivered")).toBe("UNRESOLVED_CONFLICT");
    expect(reduceDeliveryState("UNRESOLVED_CONFLICT", "email.delivered")).toBe("UNRESOLVED_CONFLICT");
  });

  it("derives the overall state from both independent roles", () => {
    expect(deriveReleaseDeliveryState("DELIVERED", "ACCEPTED")).toBe("SEALED_AWAITING_DELIVERY");
    expect(deriveReleaseDeliveryState("DELIVERED", "DELIVERED")).toBe("DELIVERED");
    expect(deriveReleaseDeliveryState("DELIVERED", "FAILED")).toBe("DELIVERY_FAILED");
    expect(deriveReleaseDeliveryState("DELIVERED", "UNRESOLVED_CONFLICT")).toBe("DELIVERY_UNRESOLVED");
  });

  it("sets an immutable two-hour boundary and expires at the boundary", () => {
    const finalizedAt = 1_800_000_000_000;
    const expiresAt = calculateExpiry(finalizedAt);

    expect(expiresAt).toBe(finalizedAt + 7_200_000);
    expect(isExpired(expiresAt, expiresAt - 1)).toBe(false);
    expect(isExpired(expiresAt, expiresAt)).toBe(true);
  });
});
