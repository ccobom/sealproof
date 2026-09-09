import { env } from "cloudflare:workers";
import { PDFDocument } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/document/hash";
import {
  handleFinalizeReleaseRequest,
  type FinalizationRouteEnvironment,
} from "../../src/http/finalize-release-route";

const NOW = 1_800_000_000_000;
let PDF_BYTES: Uint8Array;

beforeAll(async () => {
  const document = await PDFDocument.create();
  document.addPage();
  PDF_BYTES = await document.save();
});

function keyBase64(): string {
  return btoa(String.fromCharCode(...Uint8Array.from({ length: 32 }, (_, index) => index)));
}

function routeEnvironment(
  overrides: Partial<FinalizationRouteEnvironment> = {},
): FinalizationRouteEnvironment {
  return {
    RELEASE_DB: env.TEST_DB,
    RELEASE_DOCUMENTS: env.TEST_BUCKET,
    ACTIVE_WORKFLOW_VERSION: "release-v1",
    ACTIVE_KEY_VERSION: "kek-v1",
    KEY_ENCRYPTION_KEY_BASE64: keyBase64(),
    ...overrides,
  };
}

async function request(
  metadataOverrides: Record<string, unknown> = {},
  documentBytes: Uint8Array = PDF_BYTES,
): Promise<Request> {
  const form = new FormData();
  form.set("metadata", JSON.stringify({
    productionEmail: "producer@example.invalid",
    signerEmail: "signer@example.invalid",
    browserDocumentHash: await sha256Hex(documentBytes),
    ...metadataOverrides,
  }));
  form.set("document", new File([documentBytes], "release.pdf", { type: "application/pdf" }));
  return new Request("https://sealproof.invalid/api/releases/finalize", {
    method: "POST",
    body: form,
  });
}

async function durableReleaseCount(): Promise<number> {
  const row = await env.TEST_DB.prepare("SELECT COUNT(*) AS count FROM audit_releases")
    .first<{ count: number }>();
  return row?.count ?? -1;
}

describe("local finalization HTTP boundary", () => {
  it("uses Worker configuration and returns only the approved public result", async () => {
    const response = await handleFinalizeReleaseRequest(
      await request(),
      routeEnvironment(),
      () => NOW,
    );
    const result = await response.json<Record<string, unknown>>();

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(Object.keys(result).sort()).toEqual([
      "documentHash",
      "downloadCapability",
      "expiresAt",
      "outcome",
      "statusCapability",
      "transactionId",
    ]);
    expect(result).toMatchObject({
      outcome: "sealed",
      documentHash: await sha256Hex(PDF_BYTES),
      expiresAt: NOW + 7_200_000,
    });

    const stored = await env.TEST_DB.prepare(`
      SELECT ar.workflow_version, tr.key_version
      FROM audit_releases ar
      JOIN temporary_releases tr ON tr.transaction_id = ar.transaction_id
      WHERE ar.transaction_id = ?
    `).bind(result.transactionId).first();
    expect(stored).toEqual({ workflow_version: "release-v1", key_version: "kek-v1" });
  });

  it("rejects unknown client fields before creating durable state", async () => {
    const before = await durableReleaseCount();
    const response = await handleFinalizeReleaseRequest(
      await request({ workflowVersion: "client-selected" }),
      routeEnvironment(),
      () => NOW,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "INVALID_METADATA" });
    expect(await durableReleaseCount()).toBe(before);
  });

  it("rejects missing, duplicate, and unexpected multipart fields", async () => {
    const forms = [new FormData(), new FormData(), new FormData()];
    forms[0].set("metadata", "{}");
    forms[1].append("metadata", "{}");
    forms[1].append("metadata", "{}");
    forms[1].set("document", new File([PDF_BYTES], "release.pdf", { type: "application/pdf" }));
    forms[2].set("metadata", "{}");
    forms[2].set("document", new File([PDF_BYTES], "release.pdf", { type: "application/pdf" }));
    forms[2].set("hiddenConfiguration", "not allowed");

    const before = await durableReleaseCount();
    for (const form of forms) {
      const response = await handleFinalizeReleaseRequest(new Request(
        "https://sealproof.invalid/api/releases/finalize",
        { method: "POST", body: form },
      ), routeEnvironment(), () => NOW);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "INVALID_REQUEST" });
    }
    expect(await durableReleaseCount()).toBe(before);
  });

  it("rejects an incorrect hash and malformed PDF without durable state", async () => {
    const before = await durableReleaseCount();
    const wrongHash = await handleFinalizeReleaseRequest(
      await request({ browserDocumentHash: "0".repeat(64) }),
      routeEnvironment(),
      () => NOW,
    );
    const badBytes = new TextEncoder().encode("not a PDF");
    const badPdf = await handleFinalizeReleaseRequest(
      await request({}, badBytes),
      routeEnvironment(),
      () => NOW,
    );

    expect(wrongHash.status).toBe(400);
    await expect(wrongHash.json()).resolves.toEqual({ error: "HASH_MISMATCH" });
    expect(badPdf.status).toBe(400);
    await expect(badPdf.json()).resolves.toEqual({ error: "INVALID_PDF" });
    expect(await durableReleaseCount()).toBe(before);
  });

  it("fails closed when Worker cryptographic configuration is invalid", async () => {
    const before = await durableReleaseCount();
    const response = await handleFinalizeReleaseRequest(
      await request(),
      routeEnvironment({ KEY_ENCRYPTION_KEY_BASE64: "not-a-key" }),
      () => NOW,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "SERVICE_UNAVAILABLE" });
    expect(await durableReleaseCount()).toBe(before);
  });

  it("rejects a declared oversized request before parsing or durable state", async () => {
    const before = await durableReleaseCount();
    const response = await handleFinalizeReleaseRequest(new Request(
      "https://sealproof.invalid/api/releases/finalize",
      {
        method: "POST",
        headers: {
          "content-type": "multipart/form-data; boundary=synthetic",
          "content-length": "3100001",
        },
        body: "not parsed",
      },
    ), routeEnvironment(), () => NOW);

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: "PDF_TOO_LARGE" });
    expect(await durableReleaseCount()).toBe(before);
  });

  it("rejects non-multipart requests and unsupported methods", async () => {
    const getResponse = await handleFinalizeReleaseRequest(
      new Request("https://sealproof.invalid/api/releases/finalize"),
      routeEnvironment(),
    );
    const jsonResponse = await handleFinalizeReleaseRequest(new Request(
      "https://sealproof.invalid/api/releases/finalize",
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
    ), routeEnvironment());

    expect(getResponse.status).toBe(405);
    expect(getResponse.headers.get("allow")).toBe("POST");
    expect(jsonResponse.status).toBe(415);
    await expect(jsonResponse.json()).resolves.toEqual({ error: "INVALID_REQUEST" });
  });
});
