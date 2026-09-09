import { describe, expect, it, vi } from "vitest";
import { handleAdmissionRequest } from "../../src/admission/admission-route";
import { openFinalizationTicket } from "../../src/admission/finalization-ticket";

const NOW = 1_800_000_000_000;
const KEY = Uint8Array.from({ length: 32 }, (_, index) => index);
const KEY_BASE64 = btoa(String.fromCharCode(...KEY));
const ENVIRONMENT = {
  TURNSTILE_SECRET_KEY: "synthetic-secret",
  EXPECTED_HOSTNAME: "sealproof.example",
  ACTIVE_WORKFLOW_VERSION: "workflow-v1",
  ACTIVE_TICKET_KEY_VERSION: "ticket-v1",
  TICKET_ENCRYPTION_KEY_BASE64: KEY_BASE64,
};
const BODY = {
  productionEmail: "producer@example.invalid",
  signerEmail: "signer@example.invalid",
  browserDocumentHash: "a".repeat(64),
  turnstileToken: "synthetic-turnstile-token",
};

function request(body: unknown = BODY, options: { origin?: string; contentType?: string; method?: string } = {}) {
  return new Request("https://sealproof.example/api/releases/admissions", {
    method: options.method ?? "POST",
    headers: {
      origin: options.origin ?? "https://sealproof.example",
      "content-type": options.contentType ?? "application/json",
    },
    body: options.method === "GET" ? undefined : JSON.stringify(body),
  });
}

function acceptedFetcher() {
  return vi.fn(async () => Response.json({
    success: true,
    hostname: ENVIRONMENT.EXPECTED_HOSTNAME,
    action: "release-finalization",
  }));
}

describe("anonymous finalization admission route", () => {
  it("verifies the challenge and returns a decryptable no-store ticket without durable state", async () => {
    const response = await handleAdmissionRequest(request(), ENVIRONMENT, NOW, acceptedFetcher());
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const issued = await response.json<{ ticket: string; expiresAt: number }>();
    const opened = await openFinalizationTicket(issued.ticket, { "ticket-v1": KEY }, NOW + 1);
    expect(opened).toMatchObject({
      valid: true,
      payload: {
        productionEmail: BODY.productionEmail,
        signerEmail: BODY.signerEmail,
        documentHash: BODY.browserDocumentHash,
        workflowVersion: "workflow-v1",
      },
    });
  });

  it("rejects invalid request boundaries before consuming a Turnstile token", async () => {
    const fetcher = acceptedFetcher();
    const cases = [
      request(BODY, { method: "GET" }),
      request(BODY, { origin: "https://attacker.example" }),
      request(BODY, { contentType: "text/plain" }),
      request({ ...BODY, unknown: true }),
      request({ ...BODY, signerEmail: "invalid" }),
    ];
    for (const candidate of cases) {
      const result = await handleAdmissionRequest(candidate, ENVIRONMENT, NOW, fetcher);
      expect(result.status).toBeGreaterThanOrEqual(400);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects declared and actual oversized bodies before verification", async () => {
    const fetcher = acceptedFetcher();
    const declared = request();
    declared.headers.set("content-length", "4097");
    expect((await handleAdmissionRequest(declared, ENVIRONMENT, NOW, fetcher)).status).toBe(413);

    const oversized = request({ ...BODY, turnstileToken: "x".repeat(2_048), padding: "x".repeat(2_048) });
    expect((await handleAdmissionRequest(oversized, ENVIRONMENT, NOW, fetcher)).status).toBe(413);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("maps challenge rejection and provider failure to bounded no-store errors", async () => {
    const rejected = await handleAdmissionRequest(request(), ENVIRONMENT, NOW, async () => Response.json({ success: false }));
    expect(rejected.status).toBe(403);
    expect(await rejected.json()).toEqual({ error: "CHALLENGE_REJECTED" });
    expect(rejected.headers.get("cache-control")).toContain("no-store");

    const unavailable = await handleAdmissionRequest(request(), ENVIRONMENT, NOW, async () => { throw new Error("private detail"); });
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ error: "SERVICE_UNAVAILABLE" });
  });

  it("rejects broken local configuration without consuming a challenge", async () => {
    const fetcher = acceptedFetcher();
    const response = await handleAdmissionRequest(
      request(), { ...ENVIRONMENT, TICKET_ENCRYPTION_KEY_BASE64: "bad" }, NOW, fetcher,
    );
    expect(response.status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
