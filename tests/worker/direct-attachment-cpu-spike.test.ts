import { describe, expect, it } from "vitest";
import worker, {
  measureDirectAttachmentPreparation,
} from "../../src/worker/direct-attachment-cpu-spike";

const TOKEN = "synthetic-trigger-token-not-a-production-secret";

function pdf(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(new TextEncoder().encode("%PDF-1.7\n% synthetic CPU fixture\n"));
  return bytes;
}

async function invoke(bytes: Uint8Array, token = TOKEN): Promise<Response> {
  return worker.fetch(
    new Request("https://spike.example/spike/direct-attachment", {
      method: "POST",
      headers: {
        "content-type": "application/pdf",
        "x-spike-trigger": token,
      },
      body: bytes,
    }),
    { SPIKE_TRIGGER_TOKEN: TOKEN },
  );
}

describe("direct attachment CPU spike boundary", () => {
  it("runs the representative direct-content preparation without storage or email", async () => {
    const bytes = pdf(40_858);
    const response = await invoke(bytes);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      byteLength: bytes.byteLength,
      ciphertextBytes: bytes.byteLength + 16,
      base64Length: Math.ceil(bytes.byteLength / 3) * 4,
      roleContentsMatch: true,
      storage: "none",
      email: "none",
    }));
  });

  it("hides the route without the temporary trigger secret", async () => {
    const response = await invoke(pdf(100), "wrong");
    expect(response.status).toBe(404);
  });

  it("rejects invalid and oversized bodies before measurement", async () => {
    const invalid = await measureDirectAttachmentPreparation(new Request(
      "https://spike.example/spike/direct-attachment",
      { method: "POST", headers: { "content-type": "application/pdf" }, body: new Uint8Array(10) },
    ));
    expect(invalid.status).toBe(400);

    const oversized = await measureDirectAttachmentPreparation(new Request(
      "https://spike.example/spike/direct-attachment",
      { method: "POST", headers: { "content-type": "application/pdf" }, body: pdf(3_000_001) },
    ));
    expect(oversized.status).toBe(413);
  });

  it("runs at the exact 60 KB application boundary locally", async () => {
    const bytes = pdf(60_000);
    const response = await invoke(bytes);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      byteLength: 60_000,
      base64Length: 80_000,
      roleContentsMatch: true,
      storage: "none",
      email: "none",
    }));
  });
});
