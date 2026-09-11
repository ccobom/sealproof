# Live Failure and Retry Evidence — September 11, 2026

## Purpose

This record documents a controlled live test of a mixed delivery outcome,
role-specific retry, and privacy-preserving closeout. The release used
synthetic contents and Resend's documented bounce simulator. It records no
recipient addresses, names, agreement contents, photographs, signatures,
provider message IDs, secret values, or browser capabilities.

## Test identity

| Item | Value |
|---|---|
| Environment | `https://test.sealproof.app` |
| Cloudflare Worker | `sealproof-test` |
| Transaction ID | `95636510-a344-405b-8b50-37805d27ea93` |
| Sealed document SHA-256 | `f6e93c645b1879c363a915d72ffa7f0c4b9a629992466e7a9044dccbdc5c5e78` |
| Test date | September 11, 2026 |

## Controlled initial result

One recipient used an inbox controlled by the tester. The other role used
Resend's documented bounce-simulation address. The initial live result was:

- Worker status: `DELIVERY_FAILED`;
- production delivery: `DELIVERED`; and
- signer delivery: `FAILED`.

This demonstrated that one role's successful delivery was preserved while the
other role's controlled bounce produced a failed overall state. SealProof did
not falsely report complete delivery.

## Role-specific retry result

The tester selected the signer-only retry once. The browser returned to the
same stable result after the simulated address bounced again:

- the transaction ID remained unchanged;
- the sealed-document SHA-256 remained unchanged;
- production remained `DELIVERED`;
- signer remained `FAILED`; and
- the signer retry control remained available, consistent with one unused
  retry under the approved two-retry limit.

The successful production delivery was not resubmitted. The final retry was
deliberately left unused.

## Redacted Worker trace

The live Cloudflare tail reported the following retry sequence:

```text
POST /api/releases/REDACTED/retry          Ok
GET  /api/releases/REDACTED/status         Ok
POST /api/webhooks/resend                  Ok
POST /api/webhooks/resend                  Ok
GET  /api/releases/REDACTED/status         Ok
```

The authenticated webhook requests were consistent with provider progress
followed by the controlled bounce outcome for the retried signer message.

## Failure closeout and deletion

Production downloaded the sealed PDF using the separate download control and
then selected the delete/close control. The interface reported successful
closeout, and the Worker trace recorded:

```text
DELETE /api/releases/REDACTED              Ok
```

This response means the implemented closeout path removed the encrypted R2
object and temporary D1 release state and completed the minimal audit record.
It does not claim deletion of the downloaded local copy or data processed
independently by Resend.

## What this test demonstrates

- A live controlled bounce becomes a recipient-specific failed outcome.
- A successful recipient is not downgraded or resent during the other role's
  retry.
- Retry preserves the transaction identity and exact sealed-document hash.
- Authenticated Resend webhook events update the retried role.
- The interface retains access to the exact PDF during the failure state.
- Production can explicitly download and then close the failed release.
- SealProof-controlled temporary storage can be deleted after failure.

## Follow-up observation

The interface correctly showed the signer retry control after the first retry,
but it did not explicitly state that one retry remained. Showing the numeric
remaining-attempt count would make the bounded retry policy more transparent.

## Limits of this evidence

This test used a deterministic provider bounce. It does not demonstrate
recovery from a transient provider outage, a delayed delivery that later
succeeds, exhaustion of both retries, or every mail provider's failure
behavior. Those cases remain covered only to the extent established by the
automated and local fake-provider tests.
