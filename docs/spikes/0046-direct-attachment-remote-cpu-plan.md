# 0046 — Direct-Attachment Remote CPU Plan

- Date: September 10, 2026
- Status: Remote matrix complete; maximum does not meet a 10 ms Free-plan target
- Related local gate: `docs/spikes/0045-local-direct-attachment-sizes.md`

## Question

Can the current CPU-heavy initial-finalization and direct-attachment work complete reliably at representative and maximum PDF sizes within the limits enforced on the deployed Cloudflare account?

## Isolation and safety

The disposable Worker has:

- no D1, R2, Resend, Turnstile, static-asset, or production application binding;
- no recipient address other than hardcoded `example.invalid` placeholders;
- no real or persistent encryption key;
- no storage operation and no outgoing network request;
- a single POST route hidden behind a temporary high-entropy Worker secret;
- no response containing document bytes or Base64 attachment content; and
- full invocation observability for remote resource evidence.

The uploaded body must begin with a PDF header and cannot exceed 3,000,000 bytes. The retained runner generates deterministic synthetic bytes locally and never prints the trigger secret.

## Measured operations

One request deliberately performs the CPU-heavy operations that occur during current initial finalization and two-recipient submission:

1. read and validate the synthetic PDF upload;
2. calculate its SHA-256;
3. encrypt it with AES-GCM under a random per-document key;
4. hash the ciphertext;
5. unwrap and decrypt the ciphertext;
6. validate and hash the decrypted PDF;
7. independently verify its delivery hash and Base64-encode it once;
8. serialize a production Resend-shaped JSON body;
9. reuse the exact encoded content in a signer Resend-shaped JSON body; and
10. overwrite mutable plaintext and ciphertext buffers.

This excludes network waiting, D1 queries, R2 operations, and the actual Resend request. Those operations are primarily I/O; the isolated test is intended to expose the scalable cryptographic, encoding, and serialization cost.

## Proposed remote sequence

After explicit review and deployment approval:

1. deploy the disposable Worker with no trigger secret, leaving every request hidden;
2. create and save a temporary random trigger secret;
3. test one request at 40,858, 500,000, 1,000,000, 2,000,000, and 3,000,000 bytes;
4. inspect Cloudflare invocation outcomes and CPU measurements;
5. run a bounded reliability batch only at sizes that pass the matrix;
6. document results without retaining the temporary secret; and
7. delete the disposable Worker and clear the local shell variable.

No Resend message is required for this gate. A later provider-acceptance check should use the smallest number of emails justified by the CPU results.

## Remote evidence

The isolated Worker was deployed without bindings and enabled with one temporary random trigger secret. One request was made at each planned size. Every response returned HTTP 200 with `outcome: ok`, matching role content, no storage, and no email.

| Synthetic PDF bytes | CPU time | Wall time | Outcome |
|---:|---:|---:|---|
| 40,858 | 5 ms | 7 ms | `ok` |
| 500,000 | 43 ms | 53 ms | `ok` |
| 1,000,000 | 66 ms | 79 ms | `ok` |
| 2,000,000 | 116 ms | 131 ms | `ok` |
| 3,000,000 | 264 ms | 312 ms | `ok` |

For comparison, the earlier two-encoding harness recorded 56, 120, 119, 196, and 956 ms at the same ordered sizes. Reusing one Base64 value therefore removed substantial work, especially at the 3 MB boundary. Variability and the single sample per size prevent treating the differences as precise benchmark percentages.

The client-observed 3 MB round trip was 2,065 ms before optimization; the table above uses Cloudflare's Worker trace measurements and therefore provides the relevant CPU evidence.

## Interpretation

The optimized representative 40,858-byte request completed within a 10 ms CPU target. Every larger test exceeded that target, although all completed successfully on the deployed account. The current 3 MB ceiling therefore does not have evidence supporting reliable operation under a strict 10 ms per-invocation limit.

The harness intentionally models the CPU-heavy initial finalization and two-recipient preparation together. It does not prove the exact CPU cost of a normal browser-generated release, whose size should fall after the new 640-pixel, 300 KB-target photograph policy. The next evidence should record the byte size of a newly generated representative PDF and verify the account's actual Workers subscription and configured CPU limit before changing the product ceiling.

No repeated 3 MB batch was run because the first matrix already disproved the 10 ms maximum-size target. The tail output contained the temporary authorization header and network metadata, so raw trace output was not retained in the repository. Only the sanitized measurements above were preserved.

## Cleanup

After measurement, the disposable Worker was deleted and the temporary trigger environment variable was cleared. The trigger secret appeared in transient tail output but authorized only the synthetic, no-binding Worker; deletion removed the resource it could invoke.

## Conclusion

**Functional remote matrix passed; strict Free-plan maximum-size CPU gate failed.** It cannot be proven that 3 MB direct preparation fits a 10 ms CPU ceiling. The implementation should retain the one-encoding optimization, measure the newly reduced real PDF, verify the actual account plan, and then either lower the PDF limit or explicitly accept the applicable Workers plan.
