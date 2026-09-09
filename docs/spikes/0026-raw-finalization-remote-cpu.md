# 0026 — Remote Raw-Finalization Capacity

- Date: September 9, 2026
- Result: Pass at the 3,000,000-byte application ceiling
- Scope: Disposable Cloudflare Worker, synthetic data only

## Question

Can the proposed raw-PDF finalization work complete on the deployed Cloudflare runtime at SealProof's maximum accepted PDF size?

## Measured work

Each request opened an encrypted five-minute admission ticket, read and validated a synthetic PDF body, computed and compared its SHA-256 identity, encrypted the PDF with AES-GCM using a wrapped per-document key, and hashed the ciphertext. The spike deliberately excluded D1, R2, Resend, Turnstile, and personal information so it isolated the CPU-heavy cryptographic path.

The synthetic fixture began with a real generated PDF and was zero-padded to the requested size. Fixed keys in the disposable source were synthetic test material, not credentials. Access required a randomly generated temporary Worker secret.

## Results

Single requests succeeded at 50,000, 250,000, 500,000, 1,000,000, 2,000,000, and 3,000,000 bytes. Observed client-to-Worker round trips were respectively 82, 175, 242, 506, 968, and 1,973 milliseconds.

A subsequent worst-case reliability batch completed 20 of 20 requests at 3,000,000 bytes. Round trips ranged from 553 to 2,493 milliseconds, with a median of approximately 771 milliseconds.

These are wall-clock round trips, not direct CPU-time readings. They prove that the complete measured path ran within the limits enforced on the deployed Worker account; they do not allocate time among network transfer, scheduling, and CPU. Cloudflare's account analytics remain the appropriate source for exact billed CPU observations.

## Anomaly and correction

An initial 3 MB connection closed without a response. Later attempts intermittently returned `401` immediately after rotating the test secret. A size matrix passed in full after propagation, demonstrating that the earlier close was not reproducibly tied to 3 MB processing. The harness was then corrected to retry temporary authorization during secret propagation. The final 20-request batch had no failures.

## Conclusion

The raw-body, ticket-opening, hashing, and application-level encryption path is viable at the current 3 MB application ceiling on the deployed Cloudflare runtime. This gate does not establish end-to-end production capacity: D1 transactions, R2 writes, email delivery, rate controls, cleanup, and concurrent-user behavior still require their own integration evidence.

## Cleanup

The disposable Worker, its synthetic fixed-key code, and its temporary trigger secret were removed after measurement. The local harness is retained as auditable evidence and can be redeployed deliberately if the cryptographic path or platform limits change.
