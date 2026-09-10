import { describe, expect, it, vi } from "vitest";
import {
  ResendDeliveryError,
  ResendDeliveryProvider,
} from "../../src/delivery/resend-delivery-provider";
import type { DeliverySubmission } from "../../src/delivery/delivery-provider";

const submission: DeliverySubmission = {
  recipientRole: "SIGNER",
  recipientEmail: "signer@example.invalid",
  attachmentUrl: "https://sealproof.example/api/provider/attachments/encrypted-ticket",
  attachmentFilename: "sealproof-release.pdf",
  documentHash: "a".repeat(64),
  idempotencyKey: "sealproof/transaction_123456/signer/1",
};

function provider(fetcher: typeof fetch): ResendDeliveryProvider {
  return new ResendDeliveryProvider({
    apiKey: "re_synthetic_test_key",
    from: "SealProof <releases@sealproof.example>",
    fetcher,
  });
}

describe("Resend delivery provider", () => {
  it("calls the native fetch binding without rebinding its receiver", async () => {
    let observedReceiver: unknown;
    vi.stubGlobal("fetch", function (this: unknown) {
      observedReceiver = this;
      if (this !== undefined && this !== globalThis) {
        throw new TypeError("Illegal invocation");
      }
      return Promise.resolve(Response.json({ id: "native-receiver-safe" }));
    });

    try {
      const defaultProvider = new ResendDeliveryProvider({
        apiKey: "re_synthetic_test_key",
        from: "SealProof <releases@sealproof.example>",
      });
      await expect(defaultProvider.submit(submission)).resolves.toEqual({
        providerMessageId: "native-receiver-safe",
      });
      expect(observedReceiver === undefined || observedReceiver === globalThis).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("sends the exact bounded request and returns only the provider id", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      id: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794",
    }));

    await expect(provider(fetcher).submit(submission)).resolves.toEqual({
      providerMessageId: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794",
    });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      authorization: "Bearer re_synthetic_test_key",
      "content-type": "application/json",
      "idempotency-key": submission.idempotencyKey,
      "user-agent": "SealProof/1.0",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      from: "SealProof <releases@sealproof.example>",
      to: [submission.recipientEmail],
      subject: "Your sealed release from SealProof",
      text: `Your sealed release is attached.\n\nDocument SHA-256: ${submission.documentHash}\nKeep this email and attachment for your records.`,
      attachments: [{
        path: submission.attachmentUrl,
        filename: "sealproof-release.pdf",
      }],
    });
  });

  it.each([
    [401, "invalid_api_key", "AUTHENTICATION", false],
    [403, "validation_error", "AUTHENTICATION", false],
    [422, "invalid_parameter", "INVALID_REQUEST", false],
    [429, "rate_limit_exceeded", "RATE_LIMITED", true],
    [429, "monthly_quota_exceeded", "RATE_LIMITED", false],
    [500, "application_error", "PROVIDER_UNAVAILABLE", true],
  ] as const)("maps status %s without preserving raw provider text", async (
    status, name, category, retryable,
  ) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      name,
      message: "sensitive provider detail",
    }, { status, headers: status === 429 ? { "retry-after": "7" } : undefined }));

    const error = await provider(fetcher).submit(submission).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ResendDeliveryError);
    expect(error).toMatchObject({
      category,
      retryable,
      retryAfterSeconds: status === 429 ? 7 : undefined,
    });
    expect(String(error)).not.toContain("sensitive provider detail");
    expect(String(error)).not.toContain("re_synthetic_test_key");
  });

  it("stops consuming a response that exceeds the strict size limit", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ id: "x".repeat(17_000) }),
      { headers: { "content-type": "application/json" } },
    ));

    await expect(provider(fetcher).submit(submission)).rejects.toMatchObject({
      category: "MALFORMED_RESPONSE",
      retryable: true,
    });
  });

  it("treats network and malformed success responses as retryable provider failures", async () => {
    const networkFailure = provider(vi.fn<typeof fetch>().mockRejectedValue(
      new Error("network included secret re_should_not_escape"),
    ));
    await expect(networkFailure.submit(submission)).rejects.toMatchObject({
      category: "PROVIDER_UNAVAILABLE",
      retryable: true,
    });

    const malformed = provider(vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ id: "contains spaces" }),
    ));
    await expect(malformed.submit(submission)).rejects.toMatchObject({
      category: "MALFORMED_RESPONSE",
      retryable: true,
    });
  });

  it("rejects unsafe local configuration before making a request", () => {
    expect(() => new ResendDeliveryProvider({
      apiKey: "not-a-key",
      from: "releases@sealproof.example\r\nBcc: attacker@example.invalid",
    })).toThrow("Invalid Resend API key configuration");
  });
});
