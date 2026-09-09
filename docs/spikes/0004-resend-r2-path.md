# 0004 — Resend Retrieval from Private R2 Spike

- Date: September 8, 2026
- Result: Pass
- Related decision: `docs/decisions/0001-runtime-and-services.md`

## Question

Can Resend attach the exact synthetic PDF by retrieving it through a short-lived capability-protected Worker URL backed by private R2, thereby avoiding Worker-side Base64 conversion and remaining within the Workers Free CPU limit?

## Security controls

- The send endpoint requires a separate high-entropy trigger token.
- Recipient and sender addresses are fixed Cloudflare secrets rather than request inputs, preventing the spike from becoming an open email relay.
- The Resend key has sending-only access and is never present in browser code or the repository.
- The R2 bucket is private.
- Attachment access requires an independently generated 256-bit capability in the URL.
- Attachment responses prohibit caching and content sniffing.
- Resend API submissions use an idempotency key.
- Resend rejection immediately deletes the temporary object.
- Successful test cleanup deletes the object and verifies that `head()` returns no object.

Capability URLs can appear in infrastructure and provider logs. They are temporary bearer credentials, not permanent access controls. Production adoption requires enforced expiry, authenticated webhook processing, log-retention review, and the unconditional two-hour deletion mechanism.

## Evidence

On September 8, 2026:

- all 16 automated tests and all TypeScript checks passed before deployment;
- the browser generated and submitted a 40,858-byte synthetic PDF;
- Resend accepted the email with provider ID `4a145a3e-9565-4dd6-b716-7adbb78f9afd`;
- the test recipient received the email and its PDF attachment;
- the downloaded attachment's independently calculated SHA-256 was `e299fde1f8359057be897b3242e23039091c18af8a0a2bf8a9a6ca51e56ee51f`, exactly matching the expected hash;
- the send request used 4 ms of Worker CPU;
- Resend's successful attachment retrieval used 1 ms of Worker CPU;
- an initial attachment request returned `404`, followed by a successful `200` retrieval;
- inspection indicated the first request was consistent with a preliminary `HEAD` request, so the endpoint was amended to support both `HEAD` and `GET`;
- explicit cleanup used 3 ms of Worker CPU and returned verified deletion success;
- the test recipient observed the expected `DELETED (verified)` result.

The email body included the expected SHA-256 hash, and the recipient independently verified the downloaded attachment against it.

## Webhook observation

This send generated normal Resend email events. Resend reported that an existing webhook was disabled after unsuccessful deliveries. The sending-only API key could not modify webhook configuration, and this spike did not create or disable a webhook. The endpoint is likely an obsolete integration and must be inspected rather than re-enabled blindly.

## Conclusion

The URL-retrieval design avoids the demonstrated Base64 CPU problem and has substantial measured margin beneath the Workers Free CPU limit for the representative document. It passes API acceptance, provider retrieval, inbox delivery, and verified SealProof-controlled deletion.

The attachment-transfer strategy passes this spike. Authenticated, duplicate-safe Resend webhook handling remains a separate implementation gate. Production design must also ensure that capability expiry and R2 deletion occur automatically even when the browser closes.
