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

  it("independently hashes browser-generated PDF bytes without changing them", async () => {
    const pdfResponse = await worker.fetch(
      new Request("https://sealproof.invalid/spike/document"),
    );
    const pdfBytes = new Uint8Array(await pdfResponse.arrayBuffer());
    const browserHash = await sha256Hex(pdfBytes);
    const response = await worker.fetch(
      new Request("https://sealproof.invalid/api/spike/hash", {
        method: "POST",
        headers: { "content-type": "application/pdf" },
        body: pdfBytes,
      }),
    );
    const result = await response.json<{ byteLength: number; sha256: string }>();

    expect(response.status).toBe(200);
    expect(result.byteLength).toBe(pdfBytes.length);
    expect(result.sha256).toBe(browserHash);
  });

  it("rejects a non-PDF upload", async () => {
    const response = await worker.fetch(
      new Request("https://sealproof.invalid/api/spike/hash", {
        method: "POST",
        headers: { "content-type": "application/pdf" },
        body: "not a PDF",
      }),
    );

    expect(response.status).toBe(400);
  });

  it("stores, retrieves, encodes, and deletes the exact PDF bytes", async () => {
    const objects = new Map<string, Uint8Array>();
    const bucket = {
      async put(key: string, value: Uint8Array) {
        objects.set(key, new Uint8Array(value));
      },
      async get(key: string) {
        const value = objects.get(key);
        return value
          ? { arrayBuffer: async () => new Uint8Array(value).buffer }
          : null;
      },
      async delete(key: string) {
        objects.delete(key);
      },
      async head(key: string) {
        return objects.has(key) ? {} : null;
      },
    } as unknown as R2Bucket;
    const pdfResponse = await worker.fetch(
      new Request("https://sealproof.invalid/spike/document"),
      { SPIKE_DOCUMENTS: bucket },
    );
    const pdfBytes = new Uint8Array(await pdfResponse.arrayBuffer());
    const response = await worker.fetch(
      new Request("https://sealproof.invalid/api/spike/storage-encoding", {
        method: "POST",
        headers: { "content-type": "application/pdf" },
        body: pdfBytes,
      }),
      { SPIKE_DOCUMENTS: bucket },
    );
    const result = await response.json<{
      byteLength: number;
      inputHash: string;
      storedHash: string;
      base64Length: number;
      hashesMatch: boolean;
    }>();

    expect(response.status).toBe(200);
    expect(result.byteLength).toBe(pdfBytes.length);
    expect(result.inputHash).toBe(result.storedHash);
    expect(result.hashesMatch).toBe(true);
    expect(result.base64Length).toBe(Math.ceil(pdfBytes.length / 3) * 4);
    expect(objects.size).toBe(0);
  });

  it("does not allow an unauthenticated email send", async () => {
    const response = await worker.fetch(
      new Request("https://sealproof.invalid/api/spike/resend", {
        method: "POST",
        headers: { "content-type": "application/pdf" },
        body: "%PDF-synthetic",
      }),
      { SPIKE_DOCUMENTS: {} as R2Bucket },
    );

    expect(response.status).toBe(401);
  });

  it("does not reveal attachment details for an invalid capability", async () => {
    const response = await worker.fetch(
      new Request("https://sealproof.invalid/api/spike/attachment/not-a-capability"),
      { SPIKE_DOCUMENTS: {} as R2Bucket },
    );

    expect(response.status).toBe(404);
  });

  it("supports a bodyless attachment existence check", async () => {
    const capability = "a".repeat(64);
    const bucket = {
      async head(key: string) {
        return key === `synthetic/${capability}.pdf`
          ? { customMetadata: { sha256: "b".repeat(64) } }
          : null;
      },
    } as unknown as R2Bucket;
    const response = await worker.fetch(
      new Request(`https://sealproof.invalid/api/spike/attachment/${capability}`, {
        method: "HEAD",
      }),
      { SPIKE_DOCUMENTS: bucket },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-sealproof-sha256")).toBe("b".repeat(64));
    expect(await response.text()).toBe("");
  });
});
