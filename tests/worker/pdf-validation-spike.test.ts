import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/document/hash";
import worker from "../../src/worker/pdf-validation-spike";

const TOKEN = "synthetic-test-token";

async function request(body: Uint8Array, token = TOKEN): Promise<Response> {
  return worker.fetch(
    new Request("https://sealproof.invalid/spike/pdf-contract", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/pdf",
      },
      body,
    }),
    { SPIKE_TRIGGER_TOKEN: TOKEN },
  );
}

async function hashOnlyRequest(body: Uint8Array): Promise<Response> {
  return worker.fetch(
    new Request("https://sealproof.invalid/spike/pdf-contract?operation=hash-only", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/pdf" },
      body,
    }),
    { SPIKE_TRIGGER_TOKEN: TOKEN },
  );
}

describe("remote PDF validation spike boundary", () => {
  it("hashes authorized bytes without parsing the PDF", async () => {
    const bytes = new TextEncoder().encode("%PDF-synthetic hash-only bytes");
    const response = await hashOnlyRequest(bytes);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      byteLength: bytes.byteLength,
      sha256: await sha256Hex(bytes),
    });
  });
  it("parses and hashes an authorized three-page PDF", async () => {
    const document = await PDFDocument.create();
    for (let page = 0; page < 3; page += 1) document.addPage();
    const bytes = await document.save();

    const response = await request(bytes);
    const result = await response.json<{
      byteLength: number;
      pageCount: number;
      sha256: string;
    }>();

    expect(response.status).toBe(200);
    expect(result).toEqual({
      byteLength: bytes.byteLength,
      pageCount: 3,
      sha256: await sha256Hex(bytes),
    });
  });

  it("rejects an incorrect capability", async () => {
    const document = await PDFDocument.create();
    document.addPage();
    const response = await request(await document.save(), "incorrect-token");

    expect(response.status).toBe(401);
  });

  it("rejects a four-page PDF", async () => {
    const document = await PDFDocument.create();
    for (let page = 0; page < 4; page += 1) document.addPage();
    const response = await request(await document.save());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "TOO_MANY_PAGES" });
  });
});
