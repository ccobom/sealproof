import { describe, expect, it } from "vitest";
import { retryCountLabel } from "../../src/app/retry-copy";

describe("retry count copy", () => {
  it.each([
    [2, "2 retries remaining"],
    [1, "1 retry remaining"],
    [0, "No retries remaining"],
  ])("describes %i remaining retries", (remaining, expected) => {
    expect(retryCountLabel(remaining)).toBe(expected);
  });

  it.each([-1, 1.5, 3])("rejects an invalid count of %s", (remaining) => {
    expect(() => retryCountLabel(remaining)).toThrow("Invalid retries-remaining count");
  });
});
