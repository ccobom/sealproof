import { describe, expect, it, vi } from "vitest";
import {
  FinalizationRequestError,
  requestFinalizationAdmission,
  uploadReviewedPdf,
  type FinalizationFetcher,
} from "../../src/app/finalization-client";

const HASH = "a".repeat(64);
const CAPABILITY = "A".repeat(43);

describe("browser finalization client", () => {
  it("requests an admission ticket without browser credentials", async () => {
    const fetcher = vi.fn<FinalizationFetcher>(async () => Response.json({ ticket: "ticket", expiresAt: 2_000 }, { status: 201 }));
    const result = await requestFinalizationAdmission({
      productionEmail: "producer@example.com",
      signerEmail: "signer@example.com",
      browserDocumentHash: HASH,
      turnstileToken: "challenge-proof",
    }, fetcher);

    expect(result).toEqual({ ticket: "ticket", expiresAt: 2_000 });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/releases/admissions");
    expect(init).toMatchObject({ method: "POST", cache: "no-store", credentials: "omit", redirect: "error" });
    expect(JSON.parse(String(init?.body))).toEqual({
      productionEmail: "producer@example.com",
      signerEmail: "signer@example.com",
      browserDocumentHash: HASH,
      turnstileToken: "challenge-proof",
    });
  });

  it("uploads the exact reviewed bytes under the encrypted ticket", async () => {
    const bytes = Uint8Array.from([37, 80, 68, 70, 45, 1, 2, 3]);
    const fetcher = vi.fn<FinalizationFetcher>(async () => Response.json({
      outcome: "sealed",
      transactionId: "0808d915-b28e-4f8a-9d26-f8f9702f110f",
      documentHash: HASH,
      expiresAt: 7_202_000,
      statusCapability: CAPABILITY,
      downloadCapability: CAPABILITY,
    }, { status: 201 }));

    await uploadReviewedPdf(bytes, HASH, "encrypted-ticket", fetcher);
    const [, init] = fetcher.mock.calls[0];
    expect(init?.headers).toEqual({
      authorization: "SealProofTicket encrypted-ticket",
      "content-type": "application/pdf",
    });
    expect(new Uint8Array(init?.body as ArrayBuffer)).toEqual(bytes);
    expect(init).toMatchObject({ cache: "no-store", credentials: "omit", redirect: "error" });
  });

  it("rejects malformed admission responses and a server hash disagreement", async () => {
    await expect(requestFinalizationAdmission({
      productionEmail: "producer@example.com",
      signerEmail: "signer@example.com",
      browserDocumentHash: HASH,
      turnstileToken: "challenge-proof",
    }, async () => Response.json({ ticket: "ticket" }, { status: 201 })))
      .rejects.toBeInstanceOf(FinalizationRequestError);

    await expect(uploadReviewedPdf(
      Uint8Array.from([37, 80, 68, 70, 45]),
      HASH,
      "encrypted-ticket",
      async () => Response.json({
        outcome: "sealed",
        transactionId: "0808d915-b28e-4f8a-9d26-f8f9702f110f",
        documentHash: "b".repeat(64),
        expiresAt: 7_202_000,
        statusCapability: CAPABILITY,
        downloadCapability: CAPABILITY,
      }, { status: 201 }),
    )).rejects.toMatchObject({ stage: "upload", status: 201 });
  });

  it("exposes only the stage and status when the server rejects a request", async () => {
    await expect(requestFinalizationAdmission({
      productionEmail: "producer@example.com",
      signerEmail: "signer@example.com",
      browserDocumentHash: HASH,
      turnstileToken: "bad-proof",
    }, async () => Response.json({ error: "CHALLENGE_REJECTED", privateDetail: "do not expose" }, { status: 403 })))
      .rejects.toEqual(new FinalizationRequestError("admission", 403));
  });
});
