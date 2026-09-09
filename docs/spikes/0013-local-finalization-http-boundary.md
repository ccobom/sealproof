# 0013 — Local Finalization HTTP Boundary

- Date: September 9, 2026
- Result: Pass locally; multipart CPU and abuse-control gates remain open
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

## Conclusion

The thin local adapter passes its correctness and failure-safety gate. It remains deliberately disconnected from the Worker entry point until CPU, request-admission, abuse-control, and configuration gates are resolved.
