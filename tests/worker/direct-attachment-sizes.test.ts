import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { sha256Hex } from "../../src/document/hash";
import { FINAL_PDF_CONTRACT } from "../../src/document/pdf-contract";
import { finalizeRelease } from "../../src/release/finalize-release";
import { createProductionDeliveryHandlers } from "../../src/worker/production-delivery";
import type { ProductionDeliveryEnvironment } from "../../src/worker/production-delivery";

const NOW = 1_800_000_000_000;
const PDF_KEY = Uint8Array.from({ length: 32 }, (_, index) => index);
const TICKET_KEY = Uint8Array.from({ length: 32 }, (_, index) => index + 32);
const PROVIDER_KEY = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function syntheticPdf(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(new TextEncoder().encode("%PDF-1.7\n% SealProof synthetic size fixture\n"));
  for (let index = 48; index < bytes.length; index += 4_096) {
    bytes[index] = index % 251;
  }
  return bytes;
}

function environment(): ProductionDeliveryEnvironment {
  return {
    RELEASE_DB: env.TEST_DB,
    RELEASE_DOCUMENTS: env.TEST_BUCKET,
    TURNSTILE_SECRET_KEY: "synthetic-turnstile-secret",
    EXPECTED_HOSTNAME: "sealproof.example",
    ACTIVE_WORKFLOW_VERSION: "workflow-v1",
    ACTIVE_KEY_VERSION: "pdf-v1",
    KEY_ENCRYPTION_KEY_BASE64: base64(PDF_KEY),
    ACTIVE_TICKET_KEY_VERSION: "ticket-v1",
    TICKET_ENCRYPTION_KEY_BASE64: base64(TICKET_KEY),
    ACTIVE_PROVIDER_ATTACHMENT_KEY_VERSION: "provider-v1",
    PROVIDER_ATTACHMENT_KEYS_JSON: JSON.stringify({
      "provider-v1": base64(PROVIDER_KEY),
    }),
    RESEND_API_KEY: "re_synthetic_size_test_key",
    RESEND_FROM: "SealProof <releases@sealproof.example>",
  };
}

describe("direct attachment size boundary", () => {
  it.each([
    ["representative", 40_858],
    ["50 KB", 50_000],
    ["55 KB", 55_000],
    ["maximum", FINAL_PDF_CONTRACT.maximumBytes],
  ])("submits the exact %s PDF twice as bounded Base64 content", async (_, size) => {
    const pdfBytes = syntheticPdf(size);
    const documentHash = await sha256Hex(pdfBytes);
    const sealed = await finalizeRelease(env.TEST_DB, env.TEST_BUCKET, {
      pdfBytes,
      browserDocumentHash: documentHash,
      workflowVersion: "direct-content-size-v1",
      emailAddresses: {
        productionEmail: "producer@example.invalid",
        signerEmail: "signer@example.invalid",
      },
      keyVersion: "pdf-v1",
      keyEncryptionKey: PDF_KEY,
    }, () => NOW);
    expect(sealed.outcome).toBe("sealed");
    if (sealed.outcome !== "sealed") throw new Error("Synthetic fixture did not seal");

    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ id: `production-${size}` }))
      .mockResolvedValueOnce(Response.json({ id: `signer-${size}` }));

    await createProductionDeliveryHandlers(fetcher).afterSealed({
      transactionId: sealed.transactionId,
      publicOrigin: "https://sealproof.example",
      sealedAt: NOW + 1,
    }, environment());

    expect(fetcher).toHaveBeenCalledTimes(2);
    const bodies = fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as {
      attachments: Array<{ content?: string; path?: string; filename: string }>;
    });
    const expectedBase64Length = Math.ceil(size / 3) * 4;
    for (const body of bodies) {
      expect(body.attachments).toHaveLength(1);
      expect(body.attachments[0].filename).toBe("sealproof-release.pdf");
      expect(body.attachments[0].path).toBeUndefined();
      expect(body.attachments[0].content).toHaveLength(expectedBase64Length);
    }
    expect(bodies[0].attachments[0].content).toBe(bodies[1].attachments[0].content);

    const attempts = await env.TEST_DB.prepare(`
      SELECT recipient_role, delivery_state, provider_message_id
      FROM delivery_attempts WHERE transaction_id = ? ORDER BY id
    `).bind(sealed.transactionId).all<Record<string, unknown>>();
    expect(attempts.results).toEqual([
      expect.objectContaining({
        recipient_role: "PRODUCTION",
        delivery_state: "ACCEPTED",
        provider_message_id: `production-${size}`,
      }),
      expect.objectContaining({
        recipient_role: "SIGNER",
        delivery_state: "ACCEPTED",
        provider_message_id: `signer-${size}`,
      }),
    ]);
  });
});
