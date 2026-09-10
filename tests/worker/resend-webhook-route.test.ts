import { env } from "cloudflare:workers";
import { Webhook } from "svix";
import { describe, expect, it } from "vitest";
import { handleResendWebhookRequest } from "../../src/http/resend-webhook-route";
import {
  createProductionWorker,
  type ProductionEnvironment,
} from "../../src/worker/production-app";

const SECRET = "whsec_c2VhbHByb29mLXByb2R1Y3Rpb24tdGVzdA==";
const ORIGIN = "https://app.sealproof.test";
const NOW = Date.now();

function base64(fill: number): string {
  return btoa(String.fromCharCode(...new Uint8Array(32).fill(fill)));
}

function signedRequest(rawBody: string, secret = SECRET): Request {
  const id = "msg_route_test_1";
  const timestamp = new Date();
  return new Request(`${ORIGIN}/api/webhooks/resend`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": id,
      "svix-timestamp": String(Math.floor(timestamp.getTime() / 1_000)),
      "svix-signature": new Webhook(secret).sign(id, timestamp, rawBody),
    },
    body: rawBody,
  });
}

function environment(secret = SECRET) {
  return {
    RELEASE_DB: env.TEST_DB,
    RELEASE_DOCUMENTS: env.TEST_BUCKET,
    TURNSTILE_SECRET_KEY: "0x4AAAA-synthetic-turnstile-secret",
    TURNSTILE_SITE_KEY: "0x4AAAAAAEugZnhz6_XrWjKi",
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
    RESEND_WEBHOOK_SECRET: secret,
  };
}

function event(): string {
  return JSON.stringify({
    type: "email.delivered",
    created_at: new Date(NOW).toISOString(),
    data: { email_id: "unknown-provider-message" },
  });
}

describe("production Resend webhook route", () => {
  it("is mounted by the production composition", async () => {
    const worker = createProductionWorker({ now: () => NOW });
    const response = await worker.fetch(
      signedRequest(event()),
      environment() as ProductionEnvironment,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
  });

  it("accepts an authentic event and reveals no event details", async () => {
    const response = await handleResendWebhookRequest(
      signedRequest(event()), environment(), NOW,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("rejects a forged body before it reaches D1", async () => {
    const signed = event();
    const authentic = signedRequest(signed);
    const request = new Request(authentic.url, {
      method: "POST",
      headers: authentic.headers,
      body: signed.replace("delivered", "bounced"),
    });
    const response = await handleResendWebhookRequest(request, environment(), NOW);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "INVALID_SIGNATURE" });
  });

  it("rejects oversized, non-JSON, wrong-host, and unconfigured requests", async () => {
    const oversized = signedRequest(JSON.stringify({ padding: "x".repeat(66_000) }));
    expect((await handleResendWebhookRequest(oversized, environment(), NOW)).status).toBe(413);

    const wrongType = new Request(`${ORIGIN}/api/webhooks/resend`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    });
    expect((await handleResendWebhookRequest(wrongType, environment(), NOW)).status).toBe(415);

    const wrongHost = new Request("https://evil.example/api/webhooks/resend", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect((await handleResendWebhookRequest(wrongHost, environment(), NOW)).status).toBe(404);

    expect((await handleResendWebhookRequest(
      signedRequest(event()), environment(""), NOW,
    )).status).toBe(503);
  });

  it("permits only POST", async () => {
    const response = await handleResendWebhookRequest(
      new Request(`${ORIGIN}/api/webhooks/resend`), environment(), NOW,
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });
});
