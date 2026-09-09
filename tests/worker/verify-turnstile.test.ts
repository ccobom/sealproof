import { describe, expect, it, vi } from "vitest";
import { verifyTurnstileToken } from "../../src/admission/verify-turnstile";

const CONFIGURATION = {
  secretKey: "test-secret",
  expectedHostname: "sealproof.example",
  expectedAction: "release-finalization",
};

function response(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

describe("Turnstile admission verification", () => {
  it("accepts only a server-verified matching hostname and action", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response({
      success: true,
      hostname: CONFIGURATION.expectedHostname,
      action: CONFIGURATION.expectedAction,
    }));

    await expect(verifyTurnstileToken("synthetic-token", CONFIGURATION, fetcher))
      .resolves.toEqual({ verified: true });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ secret: "test-secret", response: "synthetic-token" });
    expect(body.idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
    expect(body).not.toHaveProperty("remoteip");
  });

  it("rejects unsuccessful, wrong-hostname, and wrong-action responses", async () => {
    for (const result of [
      { success: false, "error-codes": ["timeout-or-duplicate"] },
      { success: true, hostname: "attacker.example", action: CONFIGURATION.expectedAction },
      { success: true, hostname: CONFIGURATION.expectedHostname, action: "different-action" },
    ]) {
      await expect(verifyTurnstileToken(
        "synthetic-token", CONFIGURATION, async () => response(result),
      )).resolves.toEqual({ verified: false, reason: "REJECTED" });
    }
  });

  it("rejects missing and oversized client tokens without a network request", async () => {
    const fetcher = vi.fn(async () => response({ success: true }));
    await expect(verifyTurnstileToken("", CONFIGURATION, fetcher))
      .resolves.toEqual({ verified: false, reason: "REJECTED" });
    await expect(verifyTurnstileToken("x".repeat(2_049), CONFIGURATION, fetcher))
      .resolves.toEqual({ verified: false, reason: "REJECTED" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("fails closed on network, HTTP, malformed JSON, and invalid configuration", async () => {
    const unavailable = { verified: false, reason: "SERVICE_UNAVAILABLE" };
    await expect(verifyTurnstileToken(
      "token", CONFIGURATION, async () => { throw new Error("synthetic network detail"); },
    )).resolves.toEqual(unavailable);
    await expect(verifyTurnstileToken(
      "token", CONFIGURATION, async () => response({}, 500),
    )).resolves.toEqual(unavailable);
    await expect(verifyTurnstileToken(
      "token", CONFIGURATION, async () => new Response("not json"),
    )).resolves.toEqual(unavailable);
    await expect(verifyTurnstileToken(
      "token", { ...CONFIGURATION, secretKey: "" }, async () => response({ success: true }),
    )).resolves.toEqual(unavailable);
  });
});
