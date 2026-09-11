export function retryCountLabel(retriesRemaining: number): string {
  if (!Number.isInteger(retriesRemaining) || retriesRemaining < 0 || retriesRemaining > 2) {
    throw new Error("Invalid retries-remaining count");
  }
  if (retriesRemaining === 0) return "No retries remaining";
  return `${retriesRemaining} ${retriesRemaining === 1 ? "retry" : "retries"} remaining`;
}
