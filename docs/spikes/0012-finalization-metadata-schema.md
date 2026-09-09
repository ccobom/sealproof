# 0012 — Finalization Metadata Schema

- Date: September 9, 2026
- Result: Pass (local synthetic test)
- Related decision: `docs/decisions/0003-http-finalization-boundary.md`

## Question

Can SealProof apply strict runtime validation to the small JSON metadata portion of a finalization request before untrusted values reach cryptography, D1, R2, or delivery code?

## Scope

This spike tests a standalone schema and parser. It uses only synthetic `example.invalid` addresses and hashes. It does not expose an HTTP route, process a PDF, create state, access a secret, or contact a live service.

## Boundary

The metadata accepts exactly three properties:

- `productionEmail`;
- `signerEmail`; and
- `browserDocumentHash`.

Email addresses are trimmed, limited to 254 characters, and checked with Zod's email validator. The document hash must be exactly 64 lowercase hexadecimal characters. The serialized JSON may contain no more than 2,048 UTF-8 bytes. Unknown properties are rejected rather than removed.

Workflow version, key version, timestamps, transaction identifiers, object keys, capabilities, state, and provider configuration are intentionally absent. The future Worker route must supply those from trusted configuration or generate them itself.

## Evidence

On September 9, 2026:

- six focused tests passed;
- production, test, and browser TypeScript checks passed;
- a valid exact-shape object passed and surrounding email whitespace was removed;
- malformed JSON received a stable `INVALID_METADATA_JSON` result;
- missing, mistyped, invalid, array, null, uppercase-hash, and unknown-property inputs received a stable `INVALID_METADATA` result;
- the byte ceiling was enforced using UTF-8 encoded length rather than JavaScript character count; and
- valid metadata at exactly 2,048 bytes passed while input above 2,048 bytes was rejected before parsing.

## Remaining gates

- Bind this parser to a local multipart HTTP route.
- Bound the entire request and document part without trusting the declared `Content-Length` alone.
- Confirm invalid requests create no D1 or R2 state.
- Measure representative multipart parsing CPU remotely before accepting the proposed transport for the Free plan.
- Load workflow and encryption configuration only from the reviewed Worker environment.

## Conclusion

The strict metadata schema passes its isolated local gate. This does not yet approve the proposed multipart HTTP contract or expose a production route.
