# 0046 — Direct-Attachment Remote CPU Plan

- Date: September 10, 2026
- Status: Harness ready; remote evidence pending
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
7. independently hash and Base64-encode it for production;
8. serialize a production Resend-shaped JSON body;
9. independently hash and Base64-encode it for the signer;
10. serialize a signer Resend-shaped JSON body; and
11. overwrite mutable plaintext and ciphertext buffers.

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
