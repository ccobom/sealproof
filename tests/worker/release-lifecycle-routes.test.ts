import { env } from "cloudflare:workers";
import { PDFDocument } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { handleCloseoutReleaseRequest } from "../../src/http/closeout-release-route";
import { handleReleaseStatusRequest } from "../../src/http/release-status-route";
import { finalizeRelease } from "../../src/release/finalize-release";
import { sha256Hex } from "../../src/document/hash";

const NOW = 1_800_000_000_000;
const ORIGIN = "https://sealproof.example";
const KEY = Uint8Array.from({ length: 32 }, (_, index) => index);
const ENVIRONMENT = {
  RELEASE_DB: env.TEST_DB,
  RELEASE_DOCUMENTS: env.TEST_BUCKET,
  DELIVERY_ENABLED: "true",
  EXPECTED_HOSTNAME: "sealproof.example",
};
let PDF_BYTES: Uint8Array;

beforeAll(async () => {
  const document = await PDFDocument.create();
  document.addPage();
  PDF_BYTES = await document.save();
});

async function activeRelease() {
  const hash = await sha256Hex(PDF_BYTES);
  const result = await finalizeRelease(env.TEST_DB, env.TEST_BUCKET, {
    pdfBytes: PDF_BYTES,
    browserDocumentHash: hash,
    workflowVersion: "workflow-v1",
    emailAddresses: {
      productionEmail: "producer@example.invalid",
      signerEmail: "signer@example.invalid",
    },
    keyVersion: "pdf-kek-v1",
    keyEncryptionKey: KEY,
  }, () => NOW);
  if (result.outcome !== "sealed" && result.outcome !== "pending_recovery") {
    throw new Error("Could not create active release fixture");
  }
  return result;
}

function statusRequest(transactionId: string, capability: string): Request {
  return new Request(`${ORIGIN}/api/releases/${transactionId}/status`, {
    headers: { authorization: `Bearer ${capability}` },
  });
}

function closeoutRequest(transactionId: string, capability: string, origin = ORIGIN): Request {
  return new Request(`${ORIGIN}/api/releases/${transactionId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${capability}`, origin },
  });
}

describe("capability-authorized release lifecycle routes", () => {
  it("returns only bounded non-PII status to the status capability", async () => {
    const release = await activeRelease();
    const response = await handleReleaseStatusRequest(
      statusRequest(release.transactionId, release.statusCapability),
      ENVIRONMENT,
      NOW + 1,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const text = await response.text();
    expect(text).not.toContain("producer@example.invalid");
    expect(text).not.toContain("signer@example.invalid");
    expect(JSON.parse(text)).toEqual({
      transactionId: release.transactionId,
      documentHash: release.documentHash,
      releaseState: "SEALED_AWAITING_DELIVERY",
      productionDeliveryOutcome: "PENDING",
      signerDeliveryOutcome: "PENDING",
      productionRetriesRemaining: 2,
      signerRetriesRemaining: 2,
      productionSubmissionFailure: null,
      signerSubmissionFailure: null,
      productionSubmissionState: "PENDING_SUBMISSION",
      signerSubmissionState: "PENDING_SUBMISSION",
      failureCategory: null,
      expiresAt: release.expiresAt,
    });
  });

  it("conceals missing, wrong-capability, expired, and cross-host status requests", async () => {
    const release = await activeRelease();
    const cases = [
      new Request(`${ORIGIN}/api/releases/${release.transactionId}/status`),
      statusRequest(release.transactionId, release.downloadCapability),
      statusRequest(release.transactionId, release.statusCapability),
      new Request(`https://attacker.example/api/releases/${release.transactionId}/status`, {
        headers: { authorization: `Bearer ${release.statusCapability}` },
      }),
    ];
    const responses = [
      await handleReleaseStatusRequest(cases[0], ENVIRONMENT, NOW + 1),
      await handleReleaseStatusRequest(cases[1], ENVIRONMENT, NOW + 1),
      await handleReleaseStatusRequest(cases[2], ENVIRONMENT, release.expiresAt),
      await handleReleaseStatusRequest(cases[3], ENVIRONMENT, NOW + 1),
    ];
    expect(responses.map(({ status }) => status)).toEqual([404, 404, 404, 404]);
    expect(await Promise.all(responses.map((response) => response.json())))
      .toEqual(Array.from({ length: 4 }, () => ({ error: "NOT_FOUND" })));
  });

  it("requires the download capability and deletes temporary D1 and R2 state", async () => {
    const release = await activeRelease();
    const stored = await env.TEST_DB.prepare(`
      SELECT r2_object_key FROM temporary_releases WHERE transaction_id = ?
    `).bind(release.transactionId).first<{ r2_object_key: string }>();

    expect((await handleCloseoutReleaseRequest(
      closeoutRequest(release.transactionId, release.statusCapability), ENVIRONMENT, NOW + 1,
    )).status).toBe(404);
    expect((await handleCloseoutReleaseRequest(
      closeoutRequest(release.transactionId, release.downloadCapability, "https://attacker.example"),
      ENVIRONMENT,
      NOW + 1,
    )).status).toBe(404);
    expect(await env.TEST_BUCKET.head(stored!.r2_object_key)).not.toBeNull();

    const response = await handleCloseoutReleaseRequest(
      closeoutRequest(release.transactionId, release.downloadCapability), ENVIRONMENT, NOW + 1,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: "closed", transactionId: release.transactionId });
    expect(await env.TEST_BUCKET.head(stored!.r2_object_key)).toBeNull();
    expect(await env.TEST_DB.prepare(`
      SELECT 1 FROM temporary_releases WHERE transaction_id = ?
    `).bind(release.transactionId).first()).toBeNull();
    expect(await env.TEST_DB.prepare(`
      SELECT release_state, cleanup_outcome, closeout_reason FROM audit_releases WHERE transaction_id = ?
    `).bind(release.transactionId).first()).toEqual({
      release_state: "CLOSED",
      cleanup_outcome: "COMPLETED",
      closeout_reason: "production_closeout",
    });
  });
});
