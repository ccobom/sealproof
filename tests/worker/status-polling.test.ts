import { afterEach, describe, expect, it, vi } from "vitest";
import { needsDeliveryUpdates, pollingDelay, startStatusPolling } from "../../src/app/status-polling";
import type { ReleaseStatus } from "../../src/app/finalization-client";
const status = (production = "PENDING", signer = "FAILED") => ({
  releaseState: "DELIVERY_FAILED", productionDeliveryOutcome: production, signerDeliveryOutcome: signer,
}) as ReleaseStatus;
function fixture(read = vi.fn(async () => status())) {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const visibility = Object.assign(new EventTarget(), { hidden: false });
  const update = vi.fn(); const failed = vi.fn();
  const controller = startStatusPolling({ expiresAt: 7_200_000, read, update, failed, visibility });
  return { read, update, failed, visibility, controller };
}
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
describe("progressive recipient status polling", () => {
  it("continues after a bounce until the other recipient settles", async () => {
    const f = fixture(vi.fn().mockResolvedValueOnce(status()).mockResolvedValue(status("DELIVERED")));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.update).toHaveBeenCalledWith(status());
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.update).toHaveBeenLastCalledWith(status("DELIVERED"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.read).toHaveBeenCalledTimes(2);
    f.controller.stop();
  });
  it("slows down at one and five minutes without stopping for transient failures", async () => {
    const f = fixture(vi.fn().mockRejectedValue(Error("offline")));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.read).toHaveBeenCalledTimes(12);
    await vi.advanceTimersByTimeAsync(240_000);
    expect(f.read).toHaveBeenCalledTimes(28);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(f.read).toHaveBeenCalledTimes(28);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.read).toHaveBeenCalledTimes(29);
    expect(f.failed).toHaveBeenCalledTimes(29);
    f.controller.stop();
  });
  it("pauses while hidden and refreshes on return without resetting age", async () => {
    const f = fixture(); f.visibility.hidden = true;
    f.visibility.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(600_000);
    expect(f.read).not.toHaveBeenCalled();
    f.visibility.hidden = false; f.visibility.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.read).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.read).toHaveBeenCalledTimes(2);
    f.controller.stop();
  });
  it("shares a slow request with manual refresh and does not apply results after closeout", async () => {
    let resolve!: (s: ReleaseStatus) => void;
    const f = fixture(vi.fn(() => new Promise<ReleaseStatus>(r => { resolve = r; })));
    await vi.advanceTimersByTimeAsync(5_000);
    const manual = f.controller.refresh();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.read).toHaveBeenCalledOnce();
    f.controller.stop(); resolve(status()); await manual;
    expect(f.update).not.toHaveBeenCalled();
    f.visibility.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.read).toHaveBeenCalledOnce();
  });
  it("bounds a continuously visible two-hour wait to 142 automatic reads", async () => {
    const f = fixture();
    await vi.advanceTimersByTimeAsync(7_200_000);
    expect(f.read).toHaveBeenCalledTimes(142);
    await f.controller.refresh();
    expect(f.read).toHaveBeenCalledTimes(142);
    f.controller.stop();
  });
  it("stops all reads at expiry, including manual refresh", async () => {
    const f = fixture();
    vi.setSystemTime(7_200_000);
    await f.controller.refresh();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.read).not.toHaveBeenCalled(); f.controller.stop();
  });
  it("does not repeatedly poll finalization or settled/conflicting outcomes", () => {
    expect(needsDeliveryUpdates(status("DELIVERED", "FAILED"))).toBe(false);
    expect(needsDeliveryUpdates(status("UNRESOLVED", "FAILED"))).toBe(false);
    expect(needsDeliveryUpdates(status("UNRESOLVED", "PENDING"))).toBe(true);
    expect(needsDeliveryUpdates({ ...status(), releaseState: "FINALIZING" })).toBe(false);
    expect(needsDeliveryUpdates()).toBe(true);
    expect([pollingDelay(0), pollingDelay(60_000), pollingDelay(300_000)]).toEqual([5_000, 15_000, 60_000]);
  });
});
