import { env } from "cloudflare:workers";
import { PDFDocument } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { issueFinalizationTicket, openFinalizationTicket } from "../../src/admission/finalization-ticket";
import { sha256Hex } from "../../src/document/hash";
import { FINAL_PDF_CONTRACT } from "../../src/document/pdf-contract";
import { handleTicketFinalizationRequest } from "../../src/http/ticket-finalization-route";
import { cleanupRelease } from "../../src/cleanup/release-cleanup";

const NOW = 1_800_000_000_000;
const PDF_KEY = Uint8Array.from({ length: 32 }, (_, index) => index);
const TICKET_KEY = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);
let PDF_BYTES: Uint8Array;

function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

const ENVIRONMENT = {
  RELEASE_DB: env.TEST_DB,
  RELEASE_DOCUMENTS: env.TEST_BUCKET,
  EXPECTED_HOSTNAME: "sealproof.example",
  ACTIVE_KEY_VERSION: "pdf-kek-v1",
  KEY_ENCRYPTION_KEY_BASE64: base64(PDF_KEY),
  ACTIVE_TICKET_KEY_VERSION: "ticket-v1",
  TICKET_ENCRYPTION_KEY_BASE64: base64(TICKET_KEY),
};

beforeAll(async () => {
  const document = await PDFDocument.create();
  document.addPage();
  PDF_BYTES = await document.save();
});

async function ticket(hash?: string) {
  return issueFinalizationTicket({
    productionEmail: "producer@example.invalid",
    signerEmail: "signer@example.invalid",
    documentHash: hash ?? await sha256Hex(PDF_BYTES),
  }, "workflow-v1", "ticket-v1", TICKET_KEY, NOW);
}

function request(finalizationTicket: string, bytes = PDF_BYTES, origin = "https://sealproof.example") {
  return new Request("https://sealproof.example/api/releases/finalize", {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/pdf",
      authorization: `SealProofTicket ${finalizationTicket}`,
    },
    body: bytes,
  });
}

describe("raw PDF ticket finalization route", () => {
  it("atomically consumes a ticket and stores only encrypted PDF bytes", async () => {
    const issued = await ticket();
    const response = await handleTicketFinalizationRequest(request(issued.ticket), ENVIRONMENT, NOW + 1);
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const result = await response.json<Record<string, unknown>>();
    expect(result).toMatchObject({ outcome: "sealed", documentHash: await sha256Hex(PDF_BYTES) });

    const stored = await env.TEST_DB.prepare(`
      SELECT ca.admission_id, tr.r2_object_key
      FROM consumed_admissions ca
      JOIN temporary_releases tr ON tr.transaction_id = ca.transaction_id
      WHERE ca.transaction_id = ?
    `).bind(result.transactionId).first<{ admission_id: string; r2_object_key: string }>();
    expect(stored).not.toBeNull();
    const object = await env.TEST_BUCKET.get(stored!.r2_object_key);
    const bytes = new Uint8Array(await object!.arrayBuffer());
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).not.toBe("%PDF-");

    await expect(cleanupRelease(
      env.TEST_DB, env.TEST_BUCKET, String(result.transactionId), "production_closeout", NOW + 2,
    )).resolves.toMatchObject({ outcome: "completed" });
    expect(await env.TEST_DB.prepare(`
      SELECT 1 FROM consumed_admissions WHERE admission_id = ?
    `).bind(stored!.admission_id).first()).toBeNull();
  });

  it("allows exactly one winner when the same ticket is submitted concurrently", async () => {
    const issued = await ticket();
    const responses = await Promise.all([
      handleTicketFinalizationRequest(request(issued.ticket), ENVIRONMENT, NOW + 1),
      handleTicketFinalizationRequest(request(issued.ticket), ENVIRONMENT, NOW + 1),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 401]);
    const denied = responses.find((response) => response.status === 401)!;
    expect(await denied.json()).toEqual({ error: "INVALID_TICKET" });
  });

  it("does not consume a ticket when uploaded bytes have the wrong hash", async () => {
    const issued = await ticket("0".repeat(64));
    const response = await handleTicketFinalizationRequest(request(issued.ticket), ENVIRONMENT, NOW + 1);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "HASH_MISMATCH" });
    const opened = await openFinalizationTicket(issued.ticket, { "ticket-v1": TICKET_KEY }, NOW + 1);
    if (!opened.valid) throw new Error("Expected valid ticket fixture");
    const count = await env.TEST_DB.prepare(`
      SELECT COUNT(*) AS count FROM consumed_admissions WHERE admission_id = ?
    `).bind(opened.payload.admissionId).first<{ count: number }>();
    expect(count?.count).toBe(0);
  });

  it("rejects expired, altered, cross-origin, and unsupported requests before durable state", async () => {
    const issued = await ticket();
    const altered = issued.ticket.slice(0, -1) + (issued.ticket.endsWith("A") ? "B" : "A");
    const cases = [
      await handleTicketFinalizationRequest(request(issued.ticket), ENVIRONMENT, issued.expiresAt),
      await handleTicketFinalizationRequest(request(altered), ENVIRONMENT, NOW + 1),
      await handleTicketFinalizationRequest(request(issued.ticket, PDF_BYTES, "https://attacker.example"), ENVIRONMENT, NOW + 1),
      await handleTicketFinalizationRequest(new Request("https://sealproof.example/api/releases/finalize"), ENVIRONMENT, NOW + 1),
    ];
    expect(cases.map((response) => response.status)).toEqual([401, 401, 400, 405]);
  });

  it("rejects declared and actual oversize before finalization", async () => {
    const issued = await ticket();
    const declared = request(issued.ticket);
    declared.headers.set("content-length", String(FINAL_PDF_CONTRACT.maximumBytes + 1));
    expect((await handleTicketFinalizationRequest(declared, ENVIRONMENT, NOW + 1)).status).toBe(413);
    const oversized = new Uint8Array(FINAL_PDF_CONTRACT.maximumBytes + 1);
    oversized.set(new TextEncoder().encode("%PDF-"));
    expect((await handleTicketFinalizationRequest(
      request(issued.ticket, oversized), ENVIRONMENT, NOW + 1,
    )).status).toBe(413);
  });
});
