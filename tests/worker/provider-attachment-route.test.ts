import { env } from "cloudflare:workers";
import { PDFDocument } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { cleanupRelease } from "../../src/cleanup/release-cleanup";
import {
  issueProviderAttachmentTicket,
  openProviderAttachmentTicket,
} from "../../src/delivery/provider-attachment-ticket";
import { sha256Hex } from "../../src/document/hash";
import { handleProviderAttachmentRequest } from "../../src/http/provider-attachment-route";
import { finalizeRelease } from "../../src/release/finalize-release";

const NOW = 1_800_000_000_000;
const PDF_KEY = Uint8Array.from({ length: 32 }, (_, index) => index);
const PROVIDER_KEY = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const PROVIDER_VERSION = "provider-v1";
let PDF_BYTES: Uint8Array;

function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

const ENVIRONMENT = {
  RELEASE_DB: env.TEST_DB,
  RELEASE_DOCUMENTS: env.TEST_BUCKET,
  EXPECTED_HOSTNAME: "sealproof.example",
  ACTIVE_KEY_VERSION: "pdf-v1",
  KEY_ENCRYPTION_KEY_BASE64: base64(PDF_KEY),
  ACTIVE_PROVIDER_ATTACHMENT_KEY_VERSION: PROVIDER_VERSION,
  PROVIDER_ATTACHMENT_KEYS_JSON: JSON.stringify({ [PROVIDER_VERSION]: base64(PROVIDER_KEY) }),
};

beforeAll(async () => {
  const document = await PDFDocument.create();
  document.addPage();
  PDF_BYTES = await document.save();
});

async function fixture(role: "PRODUCTION" | "SIGNER" = "PRODUCTION") {
  const documentHash = await sha256Hex(PDF_BYTES);
  const release = await finalizeRelease(env.TEST_DB, env.TEST_BUCKET, {
    pdfBytes: PDF_BYTES,
    browserDocumentHash: documentHash,
    workflowVersion: "provider-test-v1",
    emailAddresses: {
      productionEmail: "producer@example.invalid",
      signerEmail: "signer@example.invalid",
    },
    keyVersion: "pdf-v1",
    keyEncryptionKey: PDF_KEY,
  }, () => NOW);
  if (release.outcome !== "sealed" && release.outcome !== "pending_recovery") {
    throw new Error("Could not create provider attachment fixture");
  }
  const attempt = await env.TEST_DB.prepare(`
    SELECT id FROM delivery_attempts WHERE transaction_id = ? AND recipient_role = ?
  `).bind(release.transactionId, role).first<{ id: number }>();
  const ticket = await issueProviderAttachmentTicket({
    transactionId: release.transactionId,
    attemptId: attempt!.id,
    recipientRole: role,
    documentHash,
    expiresAt: release.expiresAt,
  }, PROVIDER_VERSION, PROVIDER_KEY, NOW);
  return { release, attemptId: attempt!.id, ticket, documentHash };
}

function request(ticket: string, hostname = "sealproof.example") {
  return new Request(`https://${hostname}/api/provider/attachments/${ticket}`);
}

describe("provider attachment ticket and retrieval", () => {
  it("keeps role-scoped authorization recoverable without storing the bearer", async () => {
    const value = await fixture();
    expect(value.ticket).not.toContain("producer@example.invalid");
    expect(value.ticket).not.toContain(value.release.transactionId);
    const opened = await openProviderAttachmentTicket(
      value.ticket, { [PROVIDER_VERSION]: PROVIDER_KEY }, NOW + 1,
    );
    expect(opened).toMatchObject({
      valid: true,
      payload: {
        transactionId: value.release.transactionId,
        attemptId: value.attemptId,
        recipientRole: "PRODUCTION",
        documentHash: value.documentHash,
      },
    });
  });

  it("returns the exact decrypted PDF only while the attempt and release remain active", async () => {
    const value = await fixture("SIGNER");
    const response = await handleProviderAttachmentRequest(request(value.ticket), ENVIRONMENT, NOW + 1);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-sealproof-sha256")).toBe(value.documentHash);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF_BYTES);

    await cleanupRelease(
      env.TEST_DB, env.TEST_BUCKET, value.release.transactionId, "production_closeout", NOW + 2,
    );
    expect((await handleProviderAttachmentRequest(request(value.ticket), ENVIRONMENT, NOW + 3)).status)
      .toBe(404);
  });

  it("conceals altered, expired, cross-host, and role-mismatched tickets", async () => {
    const value = await fixture();
    const altered = value.ticket.slice(0, -1) + (value.ticket.endsWith("A") ? "B" : "A");
    const wrongRoleTicket = await issueProviderAttachmentTicket({
      transactionId: value.release.transactionId,
      attemptId: value.attemptId,
      recipientRole: "SIGNER",
      documentHash: value.documentHash,
      expiresAt: value.release.expiresAt,
    }, PROVIDER_VERSION, PROVIDER_KEY, NOW);
    const responses = [
      await handleProviderAttachmentRequest(request(altered), ENVIRONMENT, NOW + 1),
      await handleProviderAttachmentRequest(request(value.ticket), ENVIRONMENT, value.release.expiresAt),
      await handleProviderAttachmentRequest(request(value.ticket, "attacker.example"), ENVIRONMENT, NOW + 1),
      await handleProviderAttachmentRequest(request(wrongRoleTicket), ENVIRONMENT, NOW + 1),
    ];
    expect(responses.map(({ status }) => status)).toEqual([404, 404, 404, 404]);
  });
});
