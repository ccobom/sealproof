import { env } from "cloudflare:workers";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import { sha256Hex } from "../../src/document/hash";
import { finalizeRelease } from "../../src/release/finalize-release";
import { createProductionDeliveryHandlers } from "../../src/worker/production-delivery";
import type { ProductionDeliveryEnvironment } from "../../src/worker/production-delivery";

const NOW = 1_800_000_000_000;

function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

const PII_KEY = Uint8Array.from({ length: 32 }, (_, index) => index);

function environment(overrides: Partial<ProductionDeliveryEnvironment> = {}): ProductionDeliveryEnvironment {
  return {
    RELEASE_DB: env.TEST_DB,
    RELEASE_DOCUMENTS: env.TEST_BUCKET,
    TURNSTILE_SECRET_KEY: "synthetic-turnstile-secret",
    EXPECTED_HOSTNAME: "sealproof.example",
    ACTIVE_WORKFLOW_VERSION: "workflow-v1",
    ACTIVE_KEY_VERSION: "pdf-v1",
    KEY_ENCRYPTION_KEY_BASE64: base64(PII_KEY),
    ACTIVE_TICKET_KEY_VERSION: "ticket-v1",
    TICKET_ENCRYPTION_KEY_BASE64: base64(Uint8Array.from({ length: 32 }, () => 7)),
    RESEND_API_KEY: "re_synthetic_production_key",
    RESEND_FROM: "SealProof <releases@sealproof.example>",
    ...overrides,
  };
}

async function sealedRelease(): Promise<string> {
  const document = await PDFDocument.create();
  document.addPage();
  const pdfBytes = await document.save();
  const result = await finalizeRelease(env.TEST_DB, env.TEST_BUCKET, {
    pdfBytes,
    browserDocumentHash: await sha256Hex(pdfBytes),
    workflowVersion: "workflow-v1",
    emailAddresses: {
      productionEmail: "producer@example.invalid",
      signerEmail: "signer@example.invalid",
    },
    keyVersion: "pdf-v1",
    keyEncryptionKey: PII_KEY,
  }, () => NOW);
  if (result.outcome !== "sealed") throw new Error("Could not create sealed fixture");
  return result.transactionId;
}

describe("production delivery wiring", () => {
  it("uses Resend for both role attempts without exposing secrets in D1", async () => {
    const transactionId = await sealedRelease();
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ id: "resend-production-1" }))
      .mockResolvedValueOnce(Response.json({ id: "resend-signer-1" }));
    const handlers = createProductionDeliveryHandlers(fetcher);

    await handlers.afterSealed({
      transactionId,
      publicOrigin: "https://sealproof.example",
      sealedAt: NOW + 1,
    }, environment());

    expect(fetcher).toHaveBeenCalledTimes(2);
    const bodies = fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(bodies.map((body) => body.to)).toEqual([
      ["producer@example.invalid"],
      ["signer@example.invalid"],
    ]);
    const attempts = await env.TEST_DB.prepare(`
      SELECT recipient_role, delivery_state, provider_message_id
      FROM delivery_attempts WHERE transaction_id = ? ORDER BY id
    `).bind(transactionId).all<Record<string, unknown>>();
    expect(attempts.results).toEqual([
      expect.objectContaining({
        recipient_role: "PRODUCTION",
        delivery_state: "ACCEPTED",
        provider_message_id: "resend-production-1",
      }),
      expect.objectContaining({
        recipient_role: "SIGNER",
        delivery_state: "ACCEPTED",
        provider_message_id: "resend-signer-1",
      }),
    ]);
    expect(JSON.stringify(attempts.results)).not.toContain("re_synthetic_production_key");
    expect(JSON.stringify(attempts.results)).not.toContain("@example.invalid");
    const attachmentContents = bodies.map((body) => String(body.attachments[0].content));
    expect(attachmentContents).toHaveLength(2);
    expect(attachmentContents[0]).toBe(attachmentContents[1]);
    expect(attachmentContents.every((content) => content.length > 0)).toBe(true);
    expect(bodies.every((body) => body.attachments[0].path === undefined)).toBe(true);
  });

  it("fails closed before any provider request when encryption configuration is invalid", async () => {
    const transactionId = await sealedRelease();
    const fetcher = vi.fn<typeof fetch>();
    const handlers = createProductionDeliveryHandlers(fetcher);

    await expect(handlers.afterSealed({
      transactionId,
      publicOrigin: "https://sealproof.example",
      sealedAt: NOW + 1,
    }, environment({ KEY_ENCRYPTION_KEY_BASE64: "invalid" }))).rejects.toThrow(
      "Production delivery configuration is invalid",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});
