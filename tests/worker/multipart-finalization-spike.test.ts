import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/document/hash";
import { handleMultipartFinalizationSpike } from "../../src/worker/multipart-finalization-spike";

const TOKEN = "synthetic-test-token";

async function multipartRequest(
  bytes: Uint8Array,
  metadata: Record<string, unknown> = {},
): Promise<Request> {
  const form = new FormData();
  form.set("document", new File([bytes], "synthetic.pdf", { type: "application/pdf" }));
  form.set("metadata", JSON.stringify({
    productionEmail: "producer@example.invalid",
    signerEmail: "signer@example.invalid",
    browserDocumentHash: await sha256Hex(bytes),
    ...metadata,
  }));
  return new Request("https://sealproof.invalid/spike/multipart-finalization", {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}` },
    body: form,
  });
}

describe("multipart finalization CPU spike", () => {
  it("parses, validates, and hashes an authenticated synthetic request", async () => {
    const bytes = new TextEncoder().encode("%PDF-synthetic multipart spike");
    const response = await handleMultipartFinalizationSpike(
      await multipartRequest(bytes),
      { SPIKE_TRIGGER_TOKEN: TOKEN },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      byteLength: bytes.byteLength,
      metadataAccepted: true,
      sha256: await sha256Hex(bytes),
    });
  });

  it("rejects unauthorized and hash-mismatched requests", async () => {
    const bytes = new TextEncoder().encode("%PDF-synthetic multipart spike");
    const unauthorized = await handleMultipartFinalizationSpike(
      await multipartRequest(bytes),
      { SPIKE_TRIGGER_TOKEN: "different-token" },
    );
    const mismatch = await handleMultipartFinalizationSpike(
      await multipartRequest(bytes, { browserDocumentHash: "0".repeat(64) }),
      { SPIKE_TRIGGER_TOKEN: TOKEN },
    );

    expect(unauthorized.status).toBe(401);
    expect(mismatch.status).toBe(400);
    await expect(mismatch.json()).resolves.toEqual({ error: "HASH_MISMATCH" });
  });
});
