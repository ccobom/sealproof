import { env } from "cloudflare:workers";
import { PDFDocument } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { handleDownloadReleaseRequest } from "../../src/http/download-release-route";
import { finalizeRelease } from "../../src/release/finalize-release";
import { sha256Hex } from "../../src/document/hash";

const NOW = 1_800_000_000_000;
const KEY_VERSION = "kek-v1";
let PDF_BYTES: Uint8Array;

function key(): Uint8Array {
  return Uint8Array.from({ length: 32 }, (_, index) => index);
}

beforeAll(async () => {
  const document = await PDFDocument.create();
  document.addPage();
  PDF_BYTES = await document.save();
});

async function finalizedRelease() {
  const result = await finalizeRelease(env.TEST_DB, env.TEST_BUCKET, {
    pdfBytes: PDF_BYTES,
    browserDocumentHash: await sha256Hex(PDF_BYTES),
    workflowVersion: "test-v1",
    emailAddresses: {
      productionEmail: "producer@example.invalid",
      signerEmail: "signer@example.invalid",
    },
    keyVersion: KEY_VERSION,
    keyEncryptionKey: key(),
  }, () => NOW);
  if (result.outcome !== "sealed") throw new Error("Expected sealed fixture");
  return result;
}

function request(transactionId: string, capability?: string, method = "GET"): Request {
  return new Request(`https://sealproof.invalid/api/releases/${transactionId}/document`, {
    method,
    headers: capability ? { authorization: `Bearer ${capability}` } : undefined,
  });
}

describe("capability-authorized encrypted PDF download", () => {
  it("returns exact plaintext only for the matching unexpired capability", async () => {
    const release = await finalizedRelease();
    const response = await handleDownloadReleaseRequest(
      request(release.transactionId, release.downloadCapability),
      { RELEASE_DB: env.TEST_DB, RELEASE_DOCUMENTS: env.TEST_BUCKET, keyEncryptionKeys: { [KEY_VERSION]: key() } },
      NOW + 1,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("x-sealproof-sha256")).toBe(release.documentHash);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF_BYTES);
  });

  it("uses the same hidden response for missing, malformed, wrong, and expired capabilities", async () => {
    const release = await finalizedRelease();
    const environment = {
      RELEASE_DB: env.TEST_DB,
      RELEASE_DOCUMENTS: env.TEST_BUCKET,
      keyEncryptionKeys: { [KEY_VERSION]: key() },
    };
    const cases = [
      await handleDownloadReleaseRequest(request(release.transactionId), environment, NOW + 1),
      await handleDownloadReleaseRequest(request(release.transactionId, "bad"), environment, NOW + 1),
      await handleDownloadReleaseRequest(request(release.transactionId, "A".repeat(43)), environment, NOW + 1),
      await handleDownloadReleaseRequest(request(release.transactionId, release.downloadCapability), environment, NOW + 7_200_000),
    ];
    for (const response of cases) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "NOT_FOUND" });
      expect(response.headers.get("cache-control")).toContain("no-store");
    }
  });

  it("never returns bytes when ciphertext or key material cannot authenticate", async () => {
    const release = await finalizedRelease();
    const stored = await env.TEST_DB.prepare(`
      SELECT r2_object_key FROM temporary_releases WHERE transaction_id = ?
    `).bind(release.transactionId).first<{ r2_object_key: string }>();
    await env.TEST_BUCKET.put(stored!.r2_object_key, new Uint8Array([1, 2, 3]));

    const response = await handleDownloadReleaseRequest(
      request(release.transactionId, release.downloadCapability),
      { RELEASE_DB: env.TEST_DB, RELEASE_DOCUMENTS: env.TEST_BUCKET, keyEncryptionKeys: { [KEY_VERSION]: key() } },
      NOW + 1,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "SERVICE_UNAVAILABLE" });
  });

  it("rejects unsupported methods without decrypting", async () => {
    const release = await finalizedRelease();
    const response = await handleDownloadReleaseRequest(
      request(release.transactionId, release.downloadCapability, "POST"),
      { RELEASE_DB: env.TEST_DB, RELEASE_DOCUMENTS: env.TEST_BUCKET, keyEncryptionKeys: { [KEY_VERSION]: key() } },
      NOW + 1,
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
  });
});
