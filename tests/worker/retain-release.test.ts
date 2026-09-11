import { describe, expect, it, vi } from "vitest";
import { retainReleaseAndLoadStatus } from "../../src/app/retain-release";
import type { FinalizedRelease } from "../../src/app/finalization-client";

const release: FinalizedRelease = {
  outcome: "sealed",
  transactionId: "e3f3fa57-b67f-4d81-9292-bab554dd0958",
  documentHash: "a".repeat(64),
  expiresAt: 1_800_007_200_000,
  statusCapability: "s".repeat(43),
  downloadCapability: "d".repeat(43),
};

describe("retaining release controls before status", () => {
  it.each(["network", "503", "invalid-json", "invalid-status"])("retains the original capabilities after %s failure and makes only a status request", async failure => {
    let retained: FinalizedRelease | undefined;
    let retainedAtFetch: FinalizedRelease | undefined;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      retainedAtFetch = retained;
      if (failure === "network") throw Error("offline");
      if (failure === "503") return new Response(null, { status: 503 });
      if (failure === "invalid-json") return new Response("{");
      return Response.json({});
    });
    expect(await retainReleaseAndLoadStatus(release, value => { retained = value; }, fetcher)).toBeUndefined();
    expect(retained).toEqual(release);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(retainedAtFetch).toEqual(release);
    const [input, init] = fetcher.mock.calls[0];
    expect(String(input)).toBe(`/api/releases/${release.transactionId}/status`);
    expect(init?.method).toBe("GET");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${release.statusCapability}`);
  });

  it("also preserves a pending finalization without changing its outcome or expiry", async () => {
    const pending = { ...release, outcome: "pending_recovery" as const };
    const retain = vi.fn();
    await retainReleaseAndLoadStatus(pending, retain, async () => { throw Error("offline"); });
    expect(retain).toHaveBeenCalledExactlyOnceWith(pending);
  });
});
