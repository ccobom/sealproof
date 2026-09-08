import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/document/hash";
import worker from "../../src/worker";

describe("PDF and hash Worker spike", () => {
  it("returns a readable PDF whose independently calculated hash matches", async () => {
    const response = await worker.fetch(
      new Request("https://sealproof.invalid/spike/document"),
    );
    const responseHash = response.headers.get("x-sealproof-sha256");
    const bytes = new Uint8Array(await response.arrayBuffer());
    const independentlyCalculatedHash = await sha256Hex(bytes);
    const parsedDocument = await PDFDocument.load(bytes);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(bytes.slice(0, 5)).toEqual(new TextEncoder().encode("%PDF-"));
    expect(parsedDocument.getPageCount()).toBe(1);
    expect(responseHash).toMatch(/^[0-9a-f]{64}$/);
    expect(independentlyCalculatedHash).toBe(responseHash);
  });

  it("does not expose the spike at unrelated paths", async () => {
    const response = await worker.fetch(
      new Request("https://sealproof.invalid/"),
    );
    expect(response.status).toBe(404);
  });
});
