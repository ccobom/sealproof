import { describe, expect, it, vi } from "vitest";
import {
  FinalizationRequestError,
  closeoutRelease,
  requestFinalizationAdmission,
  requestReleaseStatus,
  retryFailedDelivery,
  sendLocalFakeDeliveryEvent,
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

  it("reads only matching status and closes with the stronger capability", async () => {
    const release = {
      transactionId: "0808d915-b28e-4f8a-9d26-f8f9702f110f",
      documentHash: HASH,
      statusCapability: CAPABILITY,
      downloadCapability: "B".repeat(43),
    };
    const statusFetcher = vi.fn<FinalizationFetcher>(async () => Response.json({
      transactionId: release.transactionId,
      documentHash: HASH,
      releaseState: "SEALED_AWAITING_DELIVERY",
      productionDeliveryOutcome: "PENDING",
      signerDeliveryOutcome: "PENDING",
      productionRetriesRemaining: 2,
      signerRetriesRemaining: 2,
      failureCategory: null,
      expiresAt: 7_202_000,
    }));
    await expect(requestReleaseStatus(release, statusFetcher)).resolves.toMatchObject({
      releaseState: "SEALED_AWAITING_DELIVERY",
    });
    expect(statusFetcher.mock.calls[0][1]).toMatchObject({
      method: "GET",
      headers: { authorization: `Bearer ${CAPABILITY}` },
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
    });

    const closeoutFetcher = vi.fn<FinalizationFetcher>(async () => Response.json({
      outcome: "closed",
      transactionId: release.transactionId,
    }));
    await expect(closeoutRelease(release, closeoutFetcher)).resolves.toBeUndefined();
    expect(closeoutFetcher.mock.calls[0][1]).toMatchObject({
      method: "DELETE",
      headers: { authorization: `Bearer ${release.downloadCapability}` },
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
    });
  });

  it("rejects mismatched status and closeout identities", async () => {
    const release = {
      transactionId: "0808d915-b28e-4f8a-9d26-f8f9702f110f",
      documentHash: HASH,
      statusCapability: CAPABILITY,
      downloadCapability: "B".repeat(43),
    };
    await expect(requestReleaseStatus(release, async () => Response.json({
      transactionId: "ea455c24-61f0-40e4-8c78-cde0f3cc4478",
      documentHash: HASH,
      releaseState: "SEALED_AWAITING_DELIVERY",
      productionDeliveryOutcome: "PENDING",
      signerDeliveryOutcome: "PENDING",
      productionRetriesRemaining: 2,
      signerRetriesRemaining: 2,
      failureCategory: null,
      expiresAt: 7_202_000,
    }))).rejects.toMatchObject({ stage: "status", status: 200 });

    await expect(closeoutRelease(release, async () => Response.json({
      outcome: "closed",
      transactionId: "ea455c24-61f0-40e4-8c78-cde0f3cc4478",
    }))).rejects.toMatchObject({ stage: "closeout", status: 200 });
  });

  it("sends a bounded local fake event without credentials or redirects", async () => {
    const release = {
      transactionId: "0808d915-b28e-4f8a-9d26-f8f9702f110f",
      statusCapability: CAPABILITY,
    };
    const fetcher = vi.fn<FinalizationFetcher>(async () => Response.json({
      outcome: "applied",
      recipientRole: "SIGNER",
      deliveryState: "FAILED",
      releaseState: "DELIVERY_FAILED",
    }));
    await expect(sendLocalFakeDeliveryEvent(
      release, "SIGNER", "email.bounced", fetcher,
    )).resolves.toBeUndefined();
    expect(fetcher.mock.calls[0]).toEqual([
      `/api/local/releases/${release.transactionId}/fake-webhook`,
      expect.objectContaining({
        method: "POST",
        headers: {
          authorization: `Bearer ${CAPABILITY}`,
          "content-type": "application/json",
        },
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
      }),
    ]);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      recipientRole: "SIGNER",
      eventType: "email.bounced",
    });
  });

  it("authorizes retry with the stronger download capability", async () => {
    const release = {
      transactionId: "0808d915-b28e-4f8a-9d26-f8f9702f110f",
      downloadCapability: "B".repeat(43),
    };
    const fetcher = vi.fn<FinalizationFetcher>(async () => Response.json({
      outcome: "accepted",
      recipientRole: "SIGNER",
      attemptNumber: 2,
    }));
    await expect(retryFailedDelivery(release, "SIGNER", fetcher)).resolves.toEqual({
      outcome: "accepted",
      recipientRole: "SIGNER",
      attemptNumber: 2,
    });
    expect(fetcher.mock.calls[0]).toEqual([
      `/api/releases/${release.transactionId}/retry`,
      expect.objectContaining({
        method: "POST",
        headers: {
          authorization: `Bearer ${release.downloadCapability}`,
          "content-type": "application/json",
        },
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
      }),
    ]);
  });
});
