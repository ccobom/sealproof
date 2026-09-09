# 0003 — HTTP Finalization Boundary

- Status: Proposed
- Date: September 9, 2026
- Decision owner: Project owner
- Approved dependency: Zod 4.5.4
- Validation gate: Local Worker request-boundary tests with synthetic data

## Context

The finalization coordinator has typed internal inputs, but a real HTTP request is untrusted at runtime. TypeScript cannot verify data after compilation. The Worker must reject malformed fields, unexpected fields, and client attempts to select security-sensitive configuration before calling encryption, D1, R2, or delivery code.

PDF bytes should remain binary. Encoding them inside JSON as Base64 would increase transfer size and require unnecessary conversion work. Email addresses must not be placed in URLs or headers, where infrastructure is more likely to log them.

## Proposed decision

Expose one production finalization route using `multipart/form-data`:

- `document`: the binary PDF file;
- `metadata`: a JSON string validated by a strict Zod schema containing only:
  - `productionEmail`;
  - `signerEmail`; and
  - `browserDocumentHash`.

The schema will reject missing values, wrong types, invalid email syntax, malformed SHA-256 values, and unknown properties. Request and part sizes will be bounded before durable work whenever the runtime makes that possible.

The client may not choose:

- transaction, object, or capability identifiers;
- workflow or template version;
- encryption algorithm or key version;
- finalization or expiry timestamps;
- release state; or
- storage and delivery configuration.

Those values come from reviewed Worker configuration, Worker secrets, the Worker clock, and cryptographically secure Worker-generated randomness.

## Response boundary

Successful or recoverable finalization may return only the information the browser needs for the approved workflow:

- outcome (`sealed` or `pending_recovery`);
- transaction ID;
- Worker-calculated document hash;
- expiry timestamp;
- raw status capability; and
- raw download capability.

Raw capabilities are returned once over HTTPS and only their hashes are stored in D1. Responses must not return encryption material, R2 keys, provider credentials, email addresses, or internal error details.

Rejected input receives a stable public error code and no durable release. Internal failures must not expose stack traces or provider details.

## Runtime validation dependency

Use Zod 4.5.4 for strict runtime validation at browser-to-Worker boundaries and infer the corresponding TypeScript types from the schemas. Zod is MIT licensed and introduces no install script. It supplements TypeScript; it does not authenticate requests, sanitize PDF content, prove email ownership, or replace database and storage constraints.

Zod was already present transitively through Cloudflare development tooling. This decision adds it as an explicit production dependency so production validation does not depend on an incidental development dependency.

## Alternatives considered

### Type assertions or handwritten property checks

These avoid a dependency but are easier to make incomplete and allow runtime rules to drift from TypeScript types. They are rejected for this security-sensitive boundary.

### JSON containing a Base64 PDF

This makes the envelope superficially simple but expands the largest field, adds conversion work, and repeats a strategy already rejected by the attachment-transfer spike.

### Email addresses in headers with a raw PDF body

This avoids multipart parsing but puts personal information into a location commonly captured by infrastructure logs. It is rejected.

### Two separate setup and PDF-upload requests

This can keep each body simple but creates pre-finalization state, authorization, expiry, and recovery requirements. It is deferred unless multipart parsing fails its local or remote validation gates.

## Consequences and gates

- Multipart parsing cost must be measured with a representative large PDF before assuming Free-plan compatibility.
- Tests must demonstrate strict rejection, size limits, stable public errors, Worker-owned configuration, and absence of durable state after invalid input.
- Active workflow and key versions must be loaded from reviewed Worker configuration before the route can be production-ready.
- No live route is approved by this record. Initial implementation and tests remain local and synthetic.

## Approval needed

The project owner has approved adding Zod. The multipart request format, response fields, and public error contract remain proposed until reviewed after the local test implementation.

The isolated metadata schema passed its local validation gate in `docs/spikes/0012-finalization-metadata-schema.md`. HTTP parsing, side-effect, and CPU gates remain open.
