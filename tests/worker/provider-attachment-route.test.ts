import { env } from "cloudflare:workers";
import { PDFDocument } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { cleanupRelease } from "../../src/cleanup/release-cleanup";
import {
  hashProviderAttachmentCapability,
  issueProviderAttachmentCapability,
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
  const issued = await issueProviderAttachmentCapability();
  await env.TEST_DB.prepare(`
    UPDATE delivery_attempts SET provider_capability_hash = ? WHERE id = ?
  `).bind(issued.capabilityHash, attempt!.id).run();
  return {
    release,
    attemptId: attempt!.id,
    capability: issued.capability,
    capabilityHash: issued.capabilityHash,
    documentHash,
  };
}

function request(ticket: string, hostname = "sealproof.example", method = "GET") {
  return new Request(`https://${hostname}/api/provider/attachments/${ticket}`, { method });
}

describe("provider attachment ticket and retrieval", () => {
  it("stores only the hash of a short random provider capability", async () => {
    const value = await fixture();
    expect(value.capability).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(value.capability).not.toContain(value.release.transactionId);
    expect(await hashProviderAttachmentCapability(value.capability)).toBe(value.capabilityHash);
    const stored = await env.TEST_DB.prepare(`
      SELECT provider_capability_hash FROM delivery_attempts WHERE id = ?
    `).bind(value.attemptId).first<{ provider_capability_hash: string }>();
    expect(stored?.provider_capability_hash).toBe(value.capabilityHash);
    expect(JSON.stringify(stored)).not.toContain(value.capability);
  });

  it("returns the exact decrypted PDF only while the attempt and release remain active", async () => {
    const value = await fixture("SIGNER");
    const response = await handleProviderAttachmentRequest(request(value.capability), ENVIRONMENT, NOW + 1);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-sealproof-sha256")).toBe(value.documentHash);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF_BYTES);

    await cleanupRelease(
      env.TEST_DB, env.TEST_BUCKET, value.release.transactionId, "production_closeout", NOW + 2,
    );
    expect((await handleProviderAttachmentRequest(request(value.capability), ENVIRONMENT, NOW + 3)).status)
      .toBe(404);
  });

  it("supports Resend's validated HEAD probe without returning document bytes", async () => {
    const value = await fixture("PRODUCTION");
    const response = await handleProviderAttachmentRequest(
      request(value.capability, "sealproof.example", "HEAD"), ENVIRONMENT, NOW + 1,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-length")).toBe(String(PDF_BYTES.byteLength));
    expect(response.headers.get("x-sealproof-sha256")).toBe(value.documentHash);
    expect((await response.arrayBuffer()).byteLength).toBe(0);
  });

  it("conceals altered, expired, cross-host, and unknown capabilities", async () => {
    const value = await fixture();
    const altered = value.capability.slice(0, -1)
      + (value.capability.endsWith("A") ? "B" : "A");
    const unknown = (await issueProviderAttachmentCapability()).capability;
    const responses = [
      await handleProviderAttachmentRequest(request(altered), ENVIRONMENT, NOW + 1),
      await handleProviderAttachmentRequest(request(value.capability), ENVIRONMENT, value.release.expiresAt),
      await handleProviderAttachmentRequest(request(value.capability, "attacker.example"), ENVIRONMENT, NOW + 1),
      await handleProviderAttachmentRequest(request(unknown), ENVIRONMENT, NOW + 1),
    ];
    expect(responses.map(({ status }) => status)).toEqual([404, 404, 404, 404]);
  });
});
