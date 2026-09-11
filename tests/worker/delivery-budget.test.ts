import { env } from "cloudflare:workers";
import { PDFDocument } from "pdf-lib";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { finalizeRelease } from "../../src/release/finalize-release";
import { sha256Hex } from "../../src/document/hash";
import { deliveryAvailable } from "../../src/delivery/delivery-budget";
import { handleRetryDeliveryRequest } from "../../src/http/retry-delivery-route";
import { handleTicketFinalizationRequest } from "../../src/http/ticket-finalization-route";
import { handleAdmissionRequest } from "../../src/admission/admission-route";
import { submitPendingDeliveries } from "../../src/delivery/submit-pending-deliveries";
import { runScheduledMaintenance } from "../../src/cleanup/scheduled-maintenance";
import { cleanupRelease } from "../../src/cleanup/release-cleanup";
import { createSealProofWorker } from "../../src/worker/app";
import { handleDownloadReleaseRequest } from "../../src/http/download-release-route";

const NOW = 1_800_000_000_000;
const KEY = new Uint8Array(32).fill(1);
const environment = {
  RELEASE_DB: env.TEST_DB, RELEASE_DOCUMENTS: env.TEST_BUCKET,
  DELIVERY_ENABLED: "true", EXPECTED_HOSTNAME: "sealproof.example",
  TURNSTILE_SECRET_KEY: "synthetic", ACTIVE_WORKFLOW_VERSION: "v1",
  ACTIVE_KEY_VERSION: "v1", KEY_ENCRYPTION_KEY_BASE64: btoa(String.fromCharCode(...KEY)),
  ACTIVE_TICKET_KEY_VERSION: "v1", TICKET_ENCRYPTION_KEY_BASE64: btoa(String.fromCharCode(...KEY)),
};
let pdfBytes: Uint8Array;
let browserDocumentHash: string;
beforeAll(async () => {
  const pdf = await PDFDocument.create(); pdf.addPage();
  pdfBytes = await pdf.save(); browserDocumentHash = await sha256Hex(pdfBytes);
});
beforeEach(async () => { await env.TEST_DB.prepare("DELETE FROM delivery_budget").run(); });
function finalize(admissionId = crypto.randomUUID()) {
  return finalizeRelease(env.TEST_DB, env.TEST_BUCKET, {
    admissionId, pdfBytes, browserDocumentHash, workflowVersion: "v1",
    emailAddresses: { productionEmail: "p@example.invalid", signerEmail: "s@example.invalid" },
    keyVersion: "v1", keyEncryptionKey: KEY,
  }, () => NOW);
}
async function total() {
  return (await env.TEST_DB.prepare("SELECT COALESCE(SUM(attempts), 0) AS n FROM delivery_budget").first<{ n: number }>())!.n;
}
async function seed(n: number, at = NOW - 1) {
  await env.TEST_DB.prepare("INSERT INTO delivery_budget VALUES (?, ?)").bind(at, n).run();
}
async function sealed() {
  const result = await finalize();
  if (result.outcome !== "sealed") throw Error("fixture failed");
  return result;
}
function retryRequest(transactionId: string, capability: string) {
  return new Request(`https://sealproof.example/api/releases/${transactionId}/retry`, {
    method: "POST", headers: { origin: "https://sealproof.example", "content-type": "application/json", authorization: `Bearer ${capability}` },
    body: JSON.stringify({ recipientRole: "SIGNER" }),
  });
}

describe("anonymous delivery containment", () => {
  it("rolls back both initial attempts and ticket consumption when only one slot remains", async () => {
    await seed(89);
    const admissionId = crypto.randomUUID();
    expect(await finalize(admissionId)).toEqual({ outcome: "rejected", reason: "DELIVERY_UNAVAILABLE" });
    expect(await total()).toBe(89);
    expect(await env.TEST_DB.prepare("SELECT 1 FROM consumed_admissions WHERE admission_id = ?").bind(admissionId).first()).toBeNull();
    await env.TEST_DB.prepare("DELETE FROM delivery_budget").run();
    expect(await finalize(admissionId)).toMatchObject({ outcome: "sealed" });
    expect(await total()).toBe(2);
  });
  it("allows only one concurrent finalization at 88 and never refunds on closeout", async () => {
    await seed(88);
    const results = await Promise.all([finalize(), finalize(), finalize()]);
    expect(results.filter(r => r.outcome === "sealed")).toHaveLength(1);
    expect(await total()).toBe(90);
    const winner = results.find(r => r.outcome === "sealed")!;
    if (winner.outcome !== "sealed") throw Error("missing winner");
    await cleanupRelease(env.TEST_DB, env.TEST_BUCKET, winner.transactionId, "production_closeout", NOW + 1);
    expect(await total()).toBe(90);
  });
  it("rolls back reservations on ticket replay", async () => {
    const id = crypto.randomUUID();
    const results = await Promise.all([finalize(id), finalize(id)]);
    expect(results.filter(r => r.outcome === "sealed")).toHaveLength(1);
    expect(await total()).toBe(2);
  });
  it("uses an exact rolling boundary rather than midnight and checks two slots for admission", async () => {
    await seed(89);
    expect(await deliveryAvailable(environment, NOW)).toBe(false);
    expect(await deliveryAvailable(environment, NOW, 1)).toBe(true);
    expect(await deliveryAvailable(environment, NOW - 1 + 86_400_000 - 1)).toBe(false);
    expect(await deliveryAvailable(environment, NOW - 1 + 86_400_000)).toBe(true);
  });
  it("reserves a single retry atomically and rejects another retry at capacity", async () => {
    const release = await sealed();
    await env.TEST_DB.prepare("UPDATE delivery_attempts SET delivery_state = 'FAILED' WHERE transaction_id = ?").bind(release.transactionId).run();
    await seed(87);
    const submit = vi.fn(async () => {});
    const retry = () => handleRetryDeliveryRequest(retryRequest(release.transactionId, release.downloadCapability), environment, NOW + 1, submit);
    const results = await Promise.all([retry(), retry()]);
    expect(results.every(r => r.status === 202 || r.status === 503)).toBe(true);
    expect(await total()).toBe(90);
    expect(await env.TEST_DB.prepare("SELECT COUNT(*) AS n FROM delivery_attempts WHERE transaction_id = ? AND attempt_number = 2").bind(release.transactionId).first()).toEqual({ n: 1 });
    await env.TEST_DB.prepare("UPDATE delivery_attempts SET delivery_state = 'FAILED' WHERE transaction_id = ?").bind(release.transactionId).run();
    expect((await retry()).status).toBe(503);
    expect(await total()).toBe(90);
    expect(await env.TEST_DB.prepare("SELECT 1 FROM delivery_attempts WHERE transaction_id = ? AND attempt_number = 3").bind(release.transactionId).first()).toBeNull();
  });
  it("charges ambiguous calls and additional recovery calls, then stops before provider fetch", async () => {
    const release = await sealed();
    const submit = vi.fn(async () => { throw Error("ambiguous response"); });
    const dependencies = { provider: { submit }, documents: env.TEST_BUCKET, keyEncryptionKeys: { v1: KEY } };
    await submitPendingDeliveries(env.TEST_DB, release.transactionId, dependencies, NOW + 1);
    expect(submit).toHaveBeenCalledTimes(2); expect(await total()).toBe(2);
    await submitPendingDeliveries(env.TEST_DB, release.transactionId, dependencies, NOW + 2);
    expect(submit).toHaveBeenCalledTimes(4); expect(await total()).toBe(4);
    await seed(86);
    await expect(submitPendingDeliveries(env.TEST_DB, release.transactionId, dependencies, NOW + 3)).rejects.toThrow("DELIVERY_BUDGET_EXHAUSTED");
    expect(submit).toHaveBeenCalledTimes(4); expect(await total()).toBe(90);
  });
  it.each([undefined, "false", "TRUE", "1", "", " true "])("fails closed for switch %s before reading bodies or invoking handlers", async (value) => {
    const disabled = { ...environment, DELIVERY_ENABLED: value };
    const fetcher = vi.fn<typeof fetch>();
    expect(await deliveryAvailable(disabled, NOW)).toBe(false);
    expect((await handleAdmissionRequest(new Request("https://sealproof.example/api/releases/admissions", { method: "POST" }), disabled, NOW, fetcher)).status).toBe(503);
    expect((await handleTicketFinalizationRequest(new Request("https://sealproof.example/api/releases/finalize", { method: "POST" }), disabled, NOW)).status).toBe(503);
    expect((await handleRetryDeliveryRequest(retryRequest("transaction_fixture", "x".repeat(43)), disabled, NOW)).status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled(); expect(await total()).toBe(0);
  });
  it("fails closed if D1 is unavailable", async () => {
    const broken = { ...environment, RELEASE_DB: { prepare() { throw Error("offline"); } } as unknown as D1Database };
    expect(await deliveryAvailable(broken, NOW)).toBe(false);
  });
  it("keeps cleanup running while disabled and expires only old aggregate counts", async () => {
    const release = await sealed();
    const disabled = { ...environment, DELIVERY_ENABLED: "false" };
    expect((await runScheduledMaintenance(disabled, release.expiresAt)).releasesCompleted).toBeGreaterThanOrEqual(1);
    expect(await env.TEST_DB.prepare("SELECT 1 FROM temporary_releases WHERE transaction_id = ?").bind(release.transactionId).first()).toBeNull();
    expect(await total()).toBe(2);
    await runScheduledMaintenance(disabled, NOW + 86_400_000);
    expect(await total()).toBe(0);
  });
  it("preserves status, download, and closeout while disabled", async () => {
    const release = await sealed();
    const disabled = { ...environment, DELIVERY_ENABLED: "false" };
    const worker = createSealProofWorker({ now: () => NOW + 1 });
    const root = `https://sealproof.example/api/releases/${release.transactionId}`;
    expect((await worker.fetch(new Request(root + "/status", { headers: { authorization: `Bearer ${release.statusCapability}` } }), disabled)).status).toBe(200);
    const download = await handleDownloadReleaseRequest(new Request(root + "/document", { headers: { authorization: `Bearer ${release.downloadCapability}` } }), { ...disabled, keyEncryptionKeys: { v1: KEY } }, NOW + 1);
    expect(download.status).toBe(200);
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(pdfBytes);
    expect((await worker.fetch(new Request(root, { method: "DELETE", headers: { origin: "https://sealproof.example", authorization: `Bearer ${release.downloadCapability}` } }), disabled)).status).toBe(200);
    expect(await total()).toBe(2);
  });
});
