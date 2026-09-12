import { env } from "cloudflare:workers";
import { PDFDocument } from "pdf-lib";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { finalizeRelease } from "../../src/release/finalize-release";
import { sha256Hex } from "../../src/document/hash";
import { createSealProofWorker } from "../../src/worker/app";
import { runLocalFakeDelivery } from "../../src/worker/local-app";
import { recoverFinalization, requestReleaseStatus, type FinalizedRelease } from "../../src/app/finalization-client";
import { cleanupRelease } from "../../src/cleanup/release-cleanup";

const NOW = 1_800_000_000_000;
const ORIGIN = "https://sealproof.example";
const KEY = new Uint8Array(32).fill(7);
const environment = {
  RELEASE_DB: env.TEST_DB, RELEASE_DOCUMENTS: env.TEST_BUCKET,
  DELIVERY_ENABLED: "true", EXPECTED_HOSTNAME: "sealproof.example",
  TURNSTILE_SECRET_KEY: "synthetic", ACTIVE_WORKFLOW_VERSION: "v1",
  ACTIVE_KEY_VERSION: "v1", KEY_ENCRYPTION_KEY_BASE64: btoa(String.fromCharCode(...KEY)),
  ACTIVE_TICKET_KEY_VERSION: "v1", TICKET_ENCRYPTION_KEY_BASE64: btoa(String.fromCharCode(...KEY)),
};
let pdfBytes: Uint8Array;
beforeAll(async () => { const pdf = await PDFDocument.create(); pdf.addPage(); pdfBytes = await pdf.save(); });
beforeEach(async () => { await env.TEST_DB.prepare("DELETE FROM delivery_budget").run(); });

async function interrupted(store = true): Promise<FinalizedRelease> {
  const result = await finalizeRelease(env.TEST_DB, {
    put: async (...args: Parameters<R2Bucket["put"]>) => {
      if (store) await env.TEST_BUCKET.put(...args);
      throw Error("connection lost after put");
    },
    head: async () => { throw Error("head unavailable"); },
    delete: key => env.TEST_BUCKET.delete(key),
  }, {
    admissionId: crypto.randomUUID(), pdfBytes, browserDocumentHash: await sha256Hex(pdfBytes),
    workflowVersion: "v1", emailAddresses: { productionEmail: "p@example.invalid", signerEmail: "s@example.invalid" },
    keyVersion: "v1", keyEncryptionKey: KEY,
  }, () => NOW);
  if (result.outcome !== "pending_recovery") throw Error("Expected interrupted finalization");
  return result;
}
function request(release: FinalizedRelease, capability = release.downloadCapability, origin = ORIGIN) {
  return new Request(`${ORIGIN}/api/releases/${release.transactionId}/recover`, {
    method: "POST", headers: { origin, authorization: `Bearer ${capability}` },
  });
}
async function total() {
  return (await env.TEST_DB.prepare("SELECT SUM(attempts) AS n FROM delivery_budget").first<{ n: number }>())!.n;
}
async function stored(release: FinalizedRelease) {
  return env.TEST_DB.prepare("SELECT r2_object_key, expires_at FROM temporary_releases WHERE transaction_id = ?").bind(release.transactionId).first<{ r2_object_key: string; expires_at: number }>();
}

describe("authorized interrupted finalization recovery", () => {
  it("connects the browser client to recovery of identical stored bytes and existing delivery reservations", async () => {
    const release = await interrupted();
    const before = await stored(release);
    const beforeBytes = await (await env.TEST_BUCKET.get(before!.r2_object_key))!.arrayBuffer();
    const afterSealed = vi.fn(runLocalFakeDelivery);
    const worker = createSealProofWorker({ now: () => NOW + 1, afterSealed });
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => worker.fetch(new Request(new URL(String(input), ORIGIN), {
      ...init, redirect: "manual", headers: { ...Object.fromEntries(new Headers(init?.headers)), origin: ORIGIN },
    }), environment);
    expect((await requestReleaseStatus(release, fetcher)).releaseState).toBe("FINALIZING");
    expect(await recoverFinalization(release, fetcher)).toBe("sealed");
    expect(await requestReleaseStatus(release, fetcher)).toMatchObject({
      transactionId: release.transactionId, documentHash: release.documentHash,
      expiresAt: release.expiresAt, releaseState: "SEALED_AWAITING_DELIVERY",
      productionSubmissionState: "ACCEPTED", signerSubmissionState: "ACCEPTED",
    });
    expect(await recoverFinalization(release, fetcher)).toBe("already_sealed");
    expect(afterSealed).toHaveBeenCalledOnce();
    expect(await total()).toBe(2);
    expect(await stored(release)).toEqual(before);
    expect(await (await env.TEST_BUCKET.get(before!.r2_object_key))!.arrayBuffer()).toEqual(beforeBytes);
  });
  it("does not require new capacity when the original two attempts are already reserved", async () => {
    const release = await interrupted();
    await env.TEST_DB.prepare("INSERT INTO delivery_budget VALUES (?, 88)").bind(NOW + 1).run();
    const worker = createSealProofWorker({ now: () => NOW + 2, afterSealed: runLocalFakeDelivery });
    expect((await worker.fetch(request(release), environment)).status).toBe(200);
    expect(await total()).toBe(90);
  });
  it("keeps missing storage unsealed without submitting delivery", async () => {
    const release = await interrupted(false);
    const afterSealed = vi.fn();
    const worker = createSealProofWorker({ now: () => NOW + 1, afterSealed });
    const result = await worker.fetch(request(release), environment);
    expect(result.status).toBe(202);
    expect(await result.json()).toMatchObject({ outcome: "waiting_for_pdf" });
    expect(afterSealed).not.toHaveBeenCalled();
    expect(await total()).toBe(2);
  });
  it("rejects corrupted storage without sealing or sending", async () => {
    const release = await interrupted();
    const row = await stored(release);
    await env.TEST_BUCKET.put(row!.r2_object_key, "corrupt");
    const afterSealed = vi.fn();
    const worker = createSealProofWorker({ now: () => NOW + 1, afterSealed });
    expect((await worker.fetch(request(release), environment)).status).toBe(409);
    expect(afterSealed).not.toHaveBeenCalled();
  });
  it("rejects status-only, wrong, cross-origin and expired capabilities", async () => {
    const release = await interrupted();
    const afterSealed = vi.fn();
    const worker = createSealProofWorker({ now: () => NOW + 1, afterSealed });
    for (const candidate of [request(release, release.statusCapability), request(release, "x".repeat(43)), request(release, release.downloadCapability, "https://attacker.example")]) {
      expect((await worker.fetch(candidate, environment)).status).toBe(404);
    }
    const expiredWorker = createSealProofWorker({ now: () => release.expiresAt, afterSealed });
    expect((await expiredWorker.fetch(request(release), environment)).status).toBe(404);
    expect(afterSealed).not.toHaveBeenCalled();
  });
  it("rejects closed releases and blocks recovery while delivery is disabled", async () => {
    const release = await interrupted();
    const afterSealed = vi.fn();
    const worker = createSealProofWorker({ now: () => NOW + 1, afterSealed });
    for (const value of [undefined, "false", "TRUE"]) {
      expect((await worker.fetch(request(release), { ...environment, DELIVERY_ENABLED: value })).status).toBe(503);
    }
    await cleanupRelease(env.TEST_DB, env.TEST_BUCKET, release.transactionId, "production_closeout", NOW + 1);
    expect((await worker.fetch(request(release), environment)).status).toBe(404);
    expect(afterSealed).not.toHaveBeenCalled();
  });
  it("keeps finalization pending on storage outage and recovers when storage returns", async () => {
    const release = await interrupted();
    const afterSealed = vi.fn();
    const worker = createSealProofWorker({ now: () => NOW + 1, afterSealed });
    const unavailable = { ...environment, RELEASE_DOCUMENTS: {
      head: async () => { throw Error("storage unavailable"); },
    } as unknown as R2Bucket };
    expect((await worker.fetch(request(release), unavailable)).status).toBe(503);
    expect(afterSealed).not.toHaveBeenCalled();
    expect((await worker.fetch(request(release), environment)).status).toBe(200);
    expect(afterSealed).toHaveBeenCalledOnce();
    expect(await total()).toBe(2);
  });
  it("retains successful sealing if delivery invocation fails without resubmitting on recovery replay", async () => {
    const release = await interrupted();
    const afterSealed = vi.fn(async () => { throw Error("delivery invocation interrupted"); });
    const worker = createSealProofWorker({ now: () => NOW + 1, afterSealed });
    const response = await worker.fetch(request(release), environment);
    expect(await response.json()).toMatchObject({ outcome: "sealed" });
    expect(await (await worker.fetch(request(release), environment)).json()).toMatchObject({ outcome: "already_sealed" });
    expect(afterSealed).toHaveBeenCalledOnce();
    expect(await total()).toBe(2);
    expect(await env.TEST_DB.prepare("SELECT COUNT(*) AS n FROM delivery_attempts WHERE transaction_id = ? AND delivery_state = 'PENDING_SUBMISSION'").bind(release.transactionId).first()).toEqual({ n: 2 });
  });
  it("only the concurrent sealing winner invokes delivery", async () => {
    const release = await interrupted();
    const afterSealed = vi.fn();
    const worker = createSealProofWorker({ now: () => NOW + 1, afterSealed });
    const results = await Promise.all([worker.fetch(request(release), environment), worker.fetch(request(release), environment)]);
    expect(results.some(r => r.status === 200)).toBe(true);
    expect(results.every(r => [200, 409].includes(r.status))).toBe(true);
    expect(afterSealed).toHaveBeenCalledOnce();
    expect(await total()).toBe(2);
  });
});
