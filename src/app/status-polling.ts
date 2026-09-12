import type { ReleaseStatus } from "./finalization-client";

export function needsDeliveryUpdates(status?: Pick<ReleaseStatus, "releaseState" | "productionDeliveryOutcome" | "signerDeliveryOutcome">): boolean {
  if (!status) return true;
  if (status.releaseState === "FINALIZING") return false;
  return status.productionDeliveryOutcome === "PENDING" || status.signerDeliveryOutcome === "PENDING";
}

// Age is measured from finalization, not the latest render or tab activation.
export function pollingDelay(ageMs: number): number {
  return ageMs < 60_000 ? 5_000 : ageMs < 300_000 ? 15_000 : 60_000;
}

export function startStatusPolling(options: {
  expiresAt: number;
  read: () => Promise<ReleaseStatus>;
  update: (status: ReleaseStatus) => void;
  failed: () => void;
  visibility: { readonly hidden: boolean; addEventListener(type: "visibilitychange", listener: () => void): void; removeEventListener(type: "visibilitychange", listener: () => void): void };
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | undefined;
  const clear = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  const schedule = () => {
    clear();
    if (stopped || options.visibility.hidden || now() >= options.expiresAt) return;
    const age = now() - (options.expiresAt - 7_200_000);
    timer = setTimeout(() => { void refresh(); }, Math.min(pollingDelay(age), options.expiresAt - now()));
  };
  const refresh = (): Promise<void> => {
    if (inFlight) return inFlight;
    clear();
    if (stopped || now() >= options.expiresAt) return Promise.resolve();
    inFlight = (async () => {
      try {
        const status = await options.read();
        if (stopped || now() >= options.expiresAt) return;
        options.update(status);
        if (!needsDeliveryUpdates(status)) stopped = true;
      } catch {
        if (!stopped && now() < options.expiresAt) options.failed();
      }
    })().finally(() => { inFlight = undefined; schedule(); });
    return inFlight;
  };
  const visibilityChanged = () => {
    clear();
    if (!options.visibility.hidden && !stopped) void refresh();
  };
  options.visibility.addEventListener("visibilitychange", visibilityChanged);
  schedule();
  return {
    refresh,
    stop() {
      stopped = true;
      clear();
      options.visibility.removeEventListener("visibilitychange", visibilityChanged);
    },
  };
}
