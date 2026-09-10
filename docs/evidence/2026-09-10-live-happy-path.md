# Live Happy-Path Evidence — September 10, 2026

## Purpose

This record documents one successful, start-to-finish test of the live SealProof test deployment. It records observable technical evidence without retaining recipient addresses, names, agreement contents, photographs, signatures, provider message IDs, browser capabilities, or secret values.

## Test identity

| Item | Value |
|---|---|
| Environment | `https://test.sealproof.app` |
| Cloudflare Worker | `sealproof-test` |
| Worker version | `fd65f699-b84a-497b-a536-b574b537120b` |
| Transaction ID | `8e74f5d4-4e3f-460f-8cd6-2f8894ef1fb8` |
| Sealed document SHA-256 | `200f444950b46ee23d3eb9cde96f1c1a4293daf1b1a671c048bb0faaafe36fce` |
| Test date | September 10, 2026 |
| Tested-code tag | `v0.1.0-live-test` |

## Observed result

The tester completed the production setup, device handoff, signer input, exact-PDF review, consent, and finalization workflow through the live test site.

SealProof displayed:

- Worker status: `DELIVERED`;
- production delivery: `DELIVERED`;
- signer delivery: `DELIVERED`; and
- the SHA-256 shown above.

Separate messages arrived in the production and signer inboxes. Each contained a PDF attachment. Both attachments were downloaded independently and hashed locally with SHA-256. Both calculated hashes exactly matched the hash displayed by SealProof.

The attachment was submitted to Resend as direct Base64 content. The live trace contained no request to a public provider-attachment URL.

## Redacted Worker trace

The live Cloudflare tail reported the following successful sequence. Transaction-specific status paths were redacted before being recorded here.

```text
scheduled cleanup                         Ok
GET  /api/public-config                   Ok
POST /api/releases/admissions             Ok
POST /api/releases/finalize               Ok
GET  /api/releases/REDACTED/status        Ok
POST /api/webhooks/resend                 Ok
POST /api/webhooks/resend                 Ok
POST /api/webhooks/resend                 Ok
POST /api/webhooks/resend                 Ok
GET  /api/releases/REDACTED/status        Ok
scheduled cleanup                         Ok
DELETE /api/releases/REDACTED             Ok
```

The four authenticated webhook requests were consistent with separate provider progress and delivery events for two messages. The final browser status confirmed both recipient roles as delivered.

## Closeout and deletion evidence

After delivery and attachment verification, production explicitly exited the release. The Cloudflare trace recorded the authenticated release `DELETE` request as `Ok`.

In the implemented closeout path, a successful response means SealProof:

1. authorized the request using the active closeout capability;
2. deleted the application-encrypted PDF object from private R2;
3. checked that the R2 object was absent;
4. deleted the temporary D1 release state; and
5. marked cleanup complete in the minimal audit record.

This evidence concerns storage controlled by SealProof. It does not claim deletion of the two delivered inbox copies or data processed and retained independently by Resend or recipient mail providers.

## What this test demonstrates

This single live test demonstrated that the deployed components can complete the intended happy path together:

- browser PDF generation and review;
- browser SHA-256 calculation;
- independent Worker hash agreement;
- application-encrypted temporary R2 storage;
- encrypted temporary email-address storage in D1;
- two separate direct-content Resend submissions using the exact sealed PDF;
- authenticated Resend webhook processing;
- distinct production and signer delivery tracking;
- successful receipt in both inboxes;
- byte identity of both downloaded attachments through independent SHA-256 checks; and
- explicit closeout of SealProof-controlled temporary storage.

## What this test does not demonstrate

One successful representative release does not establish:

- reliable Worker CPU and memory margin for the maximum permitted 3 MB PDF;
- behavior under substantial traffic or concurrent finalizations;
- compatibility with every browser, mobile device, camera, mail provider, or assistive technology;
- every failure, retry, delay, bounce, contradictory-webhook, or cleanup-recovery path in the live environment;
- that a delivered message was opened or read by its recipient;
- deletion from Resend or recipient mail systems;
- legal sufficiency of the included release language or electronic-signature process; or
- production readiness of the current test deployment.

This is evidence of one complete live happy path, not a claim that all production-readiness gates have passed.

## Privacy notes

- Test recipient addresses and message-provider identifiers are intentionally omitted.
- The document contents and all signer/production personal information are intentionally omitted.
- No API key, encryption key, webhook secret, Turnstile secret, or usable browser capability is included.
- The transaction ID and document hash are the deliberately minimal non-content identifiers retained for this technical evidence.
