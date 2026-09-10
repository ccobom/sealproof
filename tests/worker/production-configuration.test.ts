import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import {
  validCleanupBindings,
  validProductionConfiguration,
} from "../../src/worker/production-configuration";
import {
  createProductionWorker,
  type ProductionEnvironment,
} from "../../src/worker/production-app";

function base64(fill: number): string {
  return btoa(String.fromCharCode(...new Uint8Array(32).fill(fill)));
}

function configuration(): ProductionEnvironment {
  return {
    RELEASE_DB: env.TEST_DB,
    RELEASE_DOCUMENTS: env.TEST_BUCKET,
    TURNSTILE_SECRET_KEY: "0x4AAAA-synthetic-turnstile-secret",
    EXPECTED_HOSTNAME: "app.sealproof.test",
    ACTIVE_WORKFLOW_VERSION: "release-v1",
    ACTIVE_KEY_VERSION: "pdf-v1",
    KEY_ENCRYPTION_KEY_BASE64: base64(1),
    ACTIVE_TICKET_KEY_VERSION: "ticket-v1",
    TICKET_ENCRYPTION_KEY_BASE64: base64(2),
    ACTIVE_PROVIDER_ATTACHMENT_KEY_VERSION: "provider-v1",
    PROVIDER_ATTACHMENT_KEYS_JSON: JSON.stringify({ "provider-v1": base64(3) }),
    RESEND_API_KEY: "re_synthetic_production_key",
    RESEND_FROM: "SealProof <releases@sealproof.test>",
    RESEND_WEBHOOK_SECRET: "whsec_c2VhbHByb29mLXByb2R1Y3Rpb24tdGVzdA==",
  };
}

describe("production configuration", () => {
  it("accepts the complete structurally valid boundary", () => {
    expect(validProductionConfiguration(configuration())).toBe(true);
    expect(validCleanupBindings(configuration())).toBe(true);
  });

  it.each([
    ["EXPECTED_HOSTNAME", "localhost"],
    ["EXPECTED_HOSTNAME", "REPLACE_WITH_PRODUCTION_HOSTNAME"],
    ["ACTIVE_WORKFLOW_VERSION", ""],
    ["KEY_ENCRYPTION_KEY_BASE64", base64(2)],
    ["TICKET_ENCRYPTION_KEY_BASE64", "not-base64"],
    ["PROVIDER_ATTACHMENT_KEYS_JSON", "{}"],
    ["PROVIDER_ATTACHMENT_KEYS_JSON", JSON.stringify({ "provider-v1": base64(1) })],
    ["RESEND_API_KEY", ""],
    ["RESEND_FROM", "bad\r\nBcc: victim@example.com"],
    ["RESEND_WEBHOOK_SECRET", ""],
    ["TURNSTILE_SECRET_KEY", "short"],
  ] as const)("rejects malformed or unsafe %s", (name, value) => {
    expect(validProductionConfiguration({ ...configuration(), [name]: value })).toBe(false);
  });

  it("fails every API route before external fetch when configuration is incomplete", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const worker = createProductionWorker({ fetcher });
    const invalid = { ...configuration(), RESEND_API_KEY: "" };
    const response = await worker.fetch(new Request(
      "https://app.sealproof.test/api/releases/admissions",
      { method: "POST", headers: { origin: "https://app.sealproof.test" } },
    ), invalid as ProductionEnvironment);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "SERVICE_UNAVAILABLE" });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps cleanup eligibility independent from email secrets", () => {
    const missingEmailSecret = { ...configuration(), RESEND_API_KEY: "" };
    expect(validProductionConfiguration(missingEmailSecret)).toBe(false);
    expect(validCleanupBindings(missingEmailSecret)).toBe(true);
  });
});
