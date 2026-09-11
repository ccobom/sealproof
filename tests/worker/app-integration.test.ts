import { env } from "cloudflare:workers";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import { sha256Hex } from "../../src/document/hash";
import {
  requestFinalizationAdmission,
  uploadReviewedPdf,
  type FinalizationFetcher,
} from "../../src/app/finalization-client";
import { createSealProofWorker, type SealProofEnvironment } from "../../src/worker/app";
import { runLocalFakeDelivery } from "../../src/worker/local-app";
import localApplication from "../../src/worker/local-app";

const NOW = 1_800_000_000_000;
const ORIGIN = "https://sealproof.example";
const LOCAL_WEBHOOK_SECRET = "whsec_c2VhbHByb29mLWxvY2FsLXRlc3Qtc2VjcmV0";

function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

const ENVIRONMENT: SealProofEnvironment = {
  RELEASE_DB: env.TEST_DB,
  RELEASE_DOCUMENTS: env.TEST_BUCKET,
  TURNSTILE_SECRET_KEY: "synthetic-turnstile-secret",
  DELIVERY_ENABLED: "true",
  EXPECTED_HOSTNAME: "sealproof.example",
  ACTIVE_WORKFLOW_VERSION: "workflow-v1",
  ACTIVE_KEY_VERSION: "pdf-kek-v1",
  KEY_ENCRYPTION_KEY_BASE64: base64(Uint8Array.from({ length: 32 }, (_, index) => index)),
  ACTIVE_TICKET_KEY_VERSION: "ticket-v1",
  TICKET_ENCRYPTION_KEY_BASE64: base64(Uint8Array.from({ length: 32 }, (_, index) => 255 - index)),
};

describe("production-shaped local Worker", () => {
  it("carries synthetic reviewed bytes through admission and encrypted finalization", async () => {
    const turnstileFetcher = vi.fn(async () => Response.json({
      success: true,
      hostname: "sealproof.example",
      action: "release-finalization",
    }));
    let currentTime = NOW;
    const worker = createSealProofWorker({
      fetcher: turnstileFetcher,
      now: () => currentTime++,
      afterSealed: runLocalFakeDelivery,
    });
    const browserFetcher: FinalizationFetcher = async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("origin", ORIGIN);
      return worker.fetch(new Request(new URL(String(input), ORIGIN), {
        ...init,
        headers,
        // The browser client uses `error`; Workers' local Request supports only
        // `follow` and `manual`. Unit coverage retains the exact browser assertion.
        redirect: "manual",
      }), ENVIRONMENT);
    };

    const document = await PDFDocument.create();
    document.addPage();
    const reviewedBytes = await document.save();
    const reviewedHash = await sha256Hex(reviewedBytes);

    const admission = await requestFinalizationAdmission({
      productionEmail: "producer@example.invalid",
      signerEmail: "signer@example.invalid",
      browserDocumentHash: reviewedHash,
      turnstileToken: "synthetic-challenge-proof",
    }, browserFetcher);
    const result = await uploadReviewedPdf(reviewedBytes, reviewedHash, admission.ticket, browserFetcher);

    expect(turnstileFetcher).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ outcome: "sealed", documentHash: reviewedHash });
    const stored = await env.TEST_DB.prepare(`
      SELECT r2_object_key FROM temporary_releases WHERE transaction_id = ?
    `).bind(result.transactionId).first<{ r2_object_key: string }>();
    const object = await env.TEST_BUCKET.get(stored!.r2_object_key);
    const storedBytes = new Uint8Array(await object!.arrayBuffer());
    expect(new TextDecoder().decode(storedBytes.subarray(0, 5))).not.toBe("%PDF-");
    const attempts = await env.TEST_DB.prepare(`
      SELECT recipient_role, delivery_state, provider_message_id
      FROM delivery_attempts WHERE transaction_id = ? ORDER BY id
    `).bind(result.transactionId).all<Record<string, unknown>>();
    expect(attempts.results).toEqual([
      expect.objectContaining({ recipient_role: "PRODUCTION", delivery_state: "ACCEPTED" }),
      expect.objectContaining({ recipient_role: "SIGNER", delivery_state: "ACCEPTED" }),
    ]);
    for (const attempt of attempts.results) {
      expect(attempt.provider_message_id).toMatch(/^fake_[0-9a-f]{32}$/);
    }

    const status = await browserFetcher(`/api/releases/${result.transactionId}/status`, {
      headers: { authorization: `Bearer ${result.statusCapability}` },
    });
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({
      transactionId: result.transactionId,
      releaseState: "SEALED_AWAITING_DELIVERY",
    });

    const localEnvironment = {
      ...ENVIRONMENT,
      DELIVERY_ENABLED: "true",
      EXPECTED_HOSTNAME: "localhost",
      LOCAL_RESEND_WEBHOOK_SECRET: LOCAL_WEBHOOK_SECRET,
    };
    const fakeWebhook = (
      capability: string,
      recipientRole: "PRODUCTION" | "SIGNER",
      eventType: "email.delivered" | "email.bounced",
    ) => localApplication.fetch(new Request(
      `https://localhost:8787/api/local/releases/${result.transactionId}/fake-webhook`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${capability}`,
          "content-type": "application/json",
          origin: "https://localhost:8787",
        },
        body: JSON.stringify({ recipientRole, eventType }),
      },
    ), localEnvironment);
    expect((await fakeWebhook("A".repeat(43), "PRODUCTION", "email.delivered")).status).toBe(404);
    expect((await fakeWebhook(
      result.statusCapability, "PRODUCTION", "email.delivered",
    )).status).toBe(200);
    expect((await fakeWebhook(
      result.statusCapability, "SIGNER", "email.bounced",
    )).status).toBe(200);

    const statusAfterEvents = await browserFetcher(`/api/releases/${result.transactionId}/status`, {
      headers: { authorization: `Bearer ${result.statusCapability}` },
    });
    expect(await statusAfterEvents.json()).toMatchObject({
      releaseState: "DELIVERY_FAILED",
      productionDeliveryOutcome: "DELIVERED",
      signerDeliveryOutcome: "FAILED",
      failureCategory: "delivery_bounced",
    });

    const closeout = await browserFetcher(`/api/releases/${result.transactionId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${result.downloadCapability}` },
    });
    expect(closeout.status).toBe(200);
    expect(await env.TEST_BUCKET.head(stored!.r2_object_key)).toBeNull();

    const statusAfterCloseout = await browserFetcher(`/api/releases/${result.transactionId}/status`, {
      headers: { authorization: `Bearer ${result.statusCapability}` },
    });
    expect(statusAfterCloseout.status).toBe(404);
  });

  it("fails closed for unknown API paths without invoking assets", async () => {
    const assets = { fetch: vi.fn(async () => new Response("asset")) };
    const worker = createSealProofWorker();
    const response = await worker.fetch(
      new Request(`${ORIGIN}/api/private-unknown`),
      { ...ENVIRONMENT, ASSETS: assets },
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(assets.fetch).not.toHaveBeenCalled();
  });

  it("does not mount the local fake-webhook route on the default Worker", async () => {
    const worker = createSealProofWorker();
    const response = await worker.fetch(new Request(
      `${ORIGIN}/api/local/releases/0808d915-b28e-4f8a-9d26-f8f9702f110f/fake-webhook`,
      { method: "POST" },
    ), ENVIRONMENT);
    expect(response.status).toBe(404);
  });

  it("falls through non-API requests to static assets", async () => {
    const assets = { fetch: vi.fn(async () => new Response("app asset")) };
    const worker = createSealProofWorker();
    const response = await worker.fetch(new Request(`${ORIGIN}/`), { ...ENVIRONMENT, ASSETS: assets });
    expect(await response.text()).toBe("app asset");
    expect(assets.fetch).toHaveBeenCalledOnce();
  });
});
