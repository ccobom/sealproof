# 0013 — Finalization HTTP Boundary

- Date: September 9, 2026
- Result: Local correctness pass; multipart failed the remote Free CPU gate
- Related decision: `docs/decisions/0003-http-finalization-boundary.md`

## Question

Can a thin HTTP adapter validate a multipart finalization request, keep security configuration under Worker control, call the tested coordinator, and expose only the approved public result without creating state for rejected input?

## Scope

The tests run in the local Workers runtime with local Miniflare D1 and R2. They use generated PDFs, `example.invalid` addresses, and a test-only encryption key. The route is not connected to the deployed Worker entry point. No live resource, credential, email, or personal information is used.

## Boundary

`src/http/finalize-release-route.ts` accepts `POST` with exactly two multipart fields:

- one `application/pdf` file named `document`; and
- one string named `metadata`, validated by the schema from spike 0012.

The adapter obtains workflow version, encryption-key version, and the 256-bit key-encryption key from its Worker environment. It rejects invalid configuration before parsing the multipart body. The browser cannot provide those values.

Successful responses contain only outcome, transaction ID, Worker-calculated document hash, expiry, and the one-time raw status and download capabilities. Responses use `Cache-Control: no-store`. Internal object keys, email addresses, encryption material, and provider details are not returned.

## Evidence

On September 9, 2026, focused local tests demonstrated:

- a valid request sealed the exact PDF and returned only the approved response fields;
- stored workflow and key versions came from the Worker environment;
- unknown metadata and missing, duplicate, or unexpected multipart fields were rejected without durable state;
- an incorrect hash and malformed PDF header were rejected without durable state;
- invalid cryptographic configuration failed closed without durable state;
- non-multipart requests and unsupported methods received stable failures; and
- a declared request above 3,100,000 bytes was rejected before multipart parsing or durable state.

## Remaining gates

- A missing or dishonest `Content-Length` cannot be trusted as the sole memory or CPU boundary. The parsed PDF and metadata have independent post-parse limits, but a streaming or platform-level admission strategy remains required for hostile oversized bodies.
- Multipart parsing with a representative 2.01 MB PDF must be measured remotely before Free-plan acceptance.
- The endpoint needs an approved anti-abuse/initiation boundary before it can send email or be mounted publicly. Same-origin browser behavior alone is not authorization.
- Production secrets and D1/R2 bindings must be configured and reviewed separately.
- Delivery submission must be connected only after finalization returns `sealed`.

## Remote multipart CPU measurement

With explicit approval, version `8d68ba46-1803-423d-8bf6-4806792d4bc7` was temporarily deployed as `sealproof-multipart-finalization-spike`. It exposed one bearer-token-protected synthetic route with 100% invocation logging and no D1, R2, Resend, or other service binding.

The route performed multipart parsing, strict Zod metadata validation, PDF byte-size and header validation, SHA-256, and browser/Worker hash comparison. A Node `FormData` driver sent a valid 2,013,402-byte synthetic PDF; the complete encoded requests were 2,013,849 bytes.

After five warmups, twenty measured requests reported CPU times of:

```text
9, 6, 5, 6, 8, 13, 15, 11, 6, 7, 7, 15, 6, 10, 5, 8, 6, 10, 15, 11 ms
```

- mean: 8.95 ms;
- median: 8 ms;
- minimum: 5 ms;
- maximum: 15 ms; and
- invocations at or below 10 ms: 14 of 20.

All measured requests returned `200`, but six of twenty exceeded the nominal 10 ms allowance before encryption, D1, or R2 coordination was added. This does not provide enough margin to accept multipart finalization as reliably Free-plan-compatible.

An earlier PowerShell multipart driver produced rejected requests because its wire encoding did not match browser `FormData`; those invocations are excluded. The repository retains the browser-compatible Node driver for audit and reproduction.

The temporary Worker and secret were deleted immediately after measurement. Its former URL returned `404`. Cloudflare may retain synthetic invocation and connection metadata for its normal log-retention period; the temporary secret is not stored in the repository.

## Conclusion

The thin local adapter passes its correctness and failure-safety gate, but the multipart transport fails the intended Free-plan CPU gate at the representative large-input boundary. It remains deliberately disconnected from the Worker entry point. This result does not block building a local interactive vertical slice, but a production request format must be reconsidered alongside request admission and abuse control.
