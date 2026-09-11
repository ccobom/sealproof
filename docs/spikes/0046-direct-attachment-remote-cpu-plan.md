# 0046 — Direct-Attachment Remote CPU Plan

- Date: September 10, 2026
- Status: 60 KB candidate ceiling passed; 75 KB and maximum do not meet a 10 ms Free-plan target
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

After the reduced-photo implementation, a manually completed local release with a fresh camera capture produced a 49,755-byte final PDF. The tester confirmed that both the camera preview and PDF photograph remained clear and sufficiently large for the intended evidence. This representative document size is close to the 40,858-byte remote case that recorded 5 ms CPU, so a repeated remote batch at 49,755 bytes is the next relevant Free-plan reliability gate.

That representative-size reliability gate was then run against a fresh deployment of the isolated Worker. All 20 synthetic 49,755-byte requests returned HTTP 200. Every response reported matching production and signer attachment content, no storage, and no email. Client-observed elapsed time was 44-97 ms after the first 385 ms request, which included cold-start and network effects.

Nine of those invocations remained available in the terminal's Cloudflare trace history. All nine had `outcome: ok`, were not truncated, and recorded 4-5 ms of CPU time with 4-7 ms wall time. The terminal discarded the older trace entries, so this document does not claim CPU measurements for all 20 requests. The evidence therefore consists of a 20-of-20 functional sample and a nine-of-nine captured CPU sample below the nominal 10 ms Free-plan target.

On September 11, a follow-up ceiling search tested synthetic 75,000-byte requests. The six measurements that could be mapped unambiguously to that size recorded 14, 16, 9, 9, 11, and 9 ms of CPU time. All six completed with `outcome: ok` and no truncation, but three exceeded the nominal 10 ms target. A separate 13 ms trace was not assigned to the formal sample because its request could not be mapped confidently. The 75 KB candidate therefore failed the CPU gate.

A 60,000-byte probe then completed with `outcome: ok`, no truncation, 7 ms CPU time, and 9 ms wall time. A subsequent 20-request reliability batch at the same size produced the following sanitized evidence:

- 20 of 20 requests completed successfully;
- CPU time ranged from 3-6 ms and averaged 4.1 ms;
- wall time ranged from 3-6 ms;
- no request exceeded 10 ms CPU time; and
- no request was truncated or returned a non-`ok` outcome.

The trace was filtered before being written to a temporary local file, so authorization headers and network metadata were not retained. After summarization, the disposable Worker was deleted, its temporary shell secret was cleared, and the sanitized temporary file was deleted.

No repeated 3 MB batch was run because the first matrix already disproved the 10 ms maximum-size target. The tail output contained the temporary authorization header and network metadata, so raw trace output was not retained in the repository. Only the sanitized measurements above were preserved.

## Cleanup

After measurement, the disposable Worker was deleted and the temporary trigger environment variable was cleared. The trigger secret appeared in transient tail output but authorized only the synthetic, no-binding Worker; deletion removed the resource it could invoke.

## Conclusion

**A 60 KB candidate ceiling passed; 75 KB and the current 3 MB maximum failed the strict Free-plan CPU gate.** The manually measured 49,755-byte release fits below the passing candidate with approximately 10 KB of byte-size headroom. The result supports considering a 60,000-byte final-PDF limit, but that product limit should be approved explicitly and enforced consistently in the browser and Worker. The capture process must also prevent ordinary valid inputs from unexpectedly exceeding it; the existing 300 KB photo target and 500 KB accepted-photo maximum are not aligned with this evidence and require a separate adjustment.
