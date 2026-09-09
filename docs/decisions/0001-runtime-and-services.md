# 0001 — Runtime and Services

- Status: Accepted with amendment
- Date: September 8, 2026
- Decision owner: Project owner
- Validation gate: Browser PDF generation, Worker hashing, private R2, and Resend delivery spikes

## Context

SEALPROOF needs a small browser application and a trusted server boundary. The product collects sensitive personal information long enough to create and deliver an A/V release, but it is explicitly not a permanent document-management system.

The project owner initially preferred a Python and JavaScript foundation. After reviewing the browser/server boundary and Cloudflare runtime options, the project owner chose a single TypeScript application stack while preserving that boundary. The project priorities are:

- explicit types and runtime validation across browser/server communication;
- one primary language and dependency ecosystem;
- transparent, easily audited code;
- minimal operating costs outside Cloudflare;
- no mandatory user accounts;
- unconditional access expiry at two hours followed by recurring, verified deletion of SealProof-controlled PDF and PII.

The application must eventually generate one finalized PDF, hash its exact bytes, send separate copies to production and signer, track delivery outcomes, support retry using the same bytes, retain a minimal non-PII audit record, and delete temporary data.

## Proposed decision

### Frontend

Use React with TypeScript, built by Vite and served as Cloudflare Worker static assets.

React will manage only browser interaction: the multi-step workflow, role handoff, form state, photo capture, signature capture, progress, delivery-status display, and local download.

TypeScript will define explicit client-side data and state boundaries. Shared Zod schemas will provide TypeScript types and runtime validation for browser/server messages. Runtime input remains untrusted and must be validated again inside the Worker.

### Backend

Use TypeScript in a Cloudflare Worker.

The Worker will validate requests, authorize release capabilities, independently hash browser-generated PDF bytes, coordinate temporary storage, delivery and retry, receive authenticated webhooks, update audit state, and enforce cleanup.

Browser and Worker code share a language but not a trust level. Resend credentials, storage access, database bindings, and encryption keys exist only in the Worker environment.

### PDF and hashing

Use `pdf-lib` in the browser to construct the final PDF that the signer reviews and approves. Upload those exact bytes to the Worker, which uses Cloudflare's native Web Crypto API to independently calculate SHA-256 before storage and delivery.

This amendment changes the trust claim. The Worker proves identity and continuity of the exact approved bytes; it does not independently prove that visible PDF content corresponds to structured browser fields. The product must therefore make the exact generated PDF available for meaningful signer review before approval and describe sealing as applying to that reviewed document.

The exact signer-approved bytes are the source of truth. The Worker-calculated hash, both email attachments, temporary R2 object, and any local download must all derive from those same bytes rather than independently regenerated documents.

### Durable audit data

Use Cloudflare D1 for the approved minimal audit record and short-lived transaction state.

The browser will not connect directly to D1. Database access will occur through the backend. Schema changes will be stored as explicit SQL migrations in this repository.

### Temporary document storage

Use a private Cloudflare R2 bucket for the exact finalized PDF only if the approved retry and closeout workflow requires server-side temporary storage.

Any stored PDF must:

- be inaccessible through a public bucket URL;
- be referenced by an unguessable internal identifier;
- be encrypted according to an approved key-lifecycle design;
- be reused byte-for-byte for delivery retry rather than regenerated;
- be deleted immediately on explicit closeout or download-and-delete;
- become inaccessible exactly two hours after finalization and enter recurring verified deletion regardless of delivery state.

R2 is not approved for permanent release storage.

### Email delivery

Use Resend to send separate messages to the production and signer addresses.

Both messages must attach the same finalized PDF bytes. Resend retrieves them through a short-lived, capability-protected Worker URL backed by private R2, avoiding Worker-side Base64 conversion. Each message receives its own provider ID and role-specific delivery status. Authenticated Resend webhooks will distinguish API acceptance, delivery, delay, permanent failure, and bounce.

Resend's processing and retention are outside SealProof-controlled storage and require accurate user-facing disclosure. The final disclosure language remains an open product decision.

## Why this direction

- It uses one primary language and dependency ecosystem while retaining a strict browser/server security boundary.
- It keeps hosting, compute, database, and optional object storage within Cloudflare.
- It avoids adopting Lovable's generated architecture merely because it already exists.
- It creates a clear trust boundary: the frontend gathers and displays; the backend validates and performs; durable storage remembers only approved evidence.
- TypeScript is a first-class Cloudflare Workers language and avoids relying on the beta Python Workers runtime.
- `pdf-lib` is MIT licensed and demonstrates the needed general PDF capabilities, while remaining subject to our own Worker-runtime spike.
- D1 appears sufficient for a deliberately small transaction and audit schema.
- Resend is already available to the project and provides the required delivery webhooks.

## Alternatives considered

### Vanilla TypeScript instead of React

This would reduce dependencies. React is provisionally preferred because the application has a multi-step workflow, camera and signature components, distinct role states, and asynchronous delivery updates. React must remain small and must not import a generic component system by default.

### Python with FastAPI in a Cloudflare Worker

This preserves an explicit Python/JavaScript split and provides Pydantic validation and OpenAPI documentation. It was not selected because Cloudflare Python Workers are still beta, Python PDF-library compatibility and licensing introduced additional uncertainty, and two dependency ecosystems would make this small application harder to audit. Python remains available for isolated development tooling if a later decision justifies it, but it is not part of the deployed application proposal.

### Supabase-hosted PostgreSQL

PostgreSQL provides strong portability and transactional behavior. D1 is provisionally preferred for lower cost and fewer external services. This choice must be revisited if D1 cannot enforce the required idempotency, transaction, or audit constraints cleanly.

### No temporary object storage

Generating and sending a PDF entirely in one request would minimize custody. The approved retry workflow requires the exact same PDF bytes after an initial delivery failure, so temporary storage may be necessary. The implementation should still prove whether R2 can be avoided before adopting it.

## Consequences and risks

- The application becomes coupled to Cloudflare Workers bindings and D1.
- Shared TypeScript types do not validate runtime input by themselves; Worker-side Zod validation and database constraints remain mandatory.
- Browser PDF generation depends on device resources and requires representative mobile and browser compatibility testing.
- A compromised browser could display different content from the uploaded bytes; signer review, browser security controls, and precise product claims are part of the security boundary.
- Capability URLs are temporary bearer credentials that may appear in infrastructure or provider logs and must expire no later than the stored document.
- Browser and Worker code could be confused during review because they share a language; directory and import boundaries must make the trust boundary obvious.
- D1 may require a different concurrency design than PostgreSQL.
- Temporary R2 storage expands the sensitive-data surface and requires encryption, access control, expiry, and cleanup evidence.
- Resend may retain email messages and attachments independently of SealProof's two-hour deletion rule.
- Webhook delivery is asynchronous, may be duplicated, and may arrive after SealProof has deleted the PDF.

## Validation gate

Validation evidence is recorded in `docs/spikes/0001-worker-pdf-hash.md` through `0004-resend-r2-path.md`. Server-side PDF construction failed the Free CPU requirement. Browser-side construction, independent Worker hashing, private R2 retrieval, capability-protected Resend attachment delivery, inbox receipt, exact downloaded-byte verification, and explicit R2 deletion passed. The send, attachment retrieval, and cleanup requests used 4 ms, 1 ms, and 3 ms of Worker CPU respectively.

The completed technical spikes demonstrated that the selected TypeScript stack can:

1. generate a readable PDF from hardcoded release information in the browser;
2. embed a representative photo and signature;
3. calculate the PDF's SHA-256 hash;
4. independently recalculate and match that hash from the returned bytes;
5. transfer the exact PDF through private R2 and Resend without Worker-side Base64 encoding;
6. fit the Cloudflare plan's applicable CPU, memory, request, and output limits.

The spikes used only synthetic document data and deleted every temporary Cloudflare resource after measurement.

## Decision outcome

**Accepted with amendment** — browser-side PDF generation and capability-protected provider retrieval replace Worker-side PDF generation and attachment encoding while retaining the TypeScript, Cloudflare, R2, D1, and Resend architecture.

This acceptance does not approve unfinished security mechanisms. Authenticated duplicate-safe webhooks, production cleanup configuration, signer review behavior, runtime schemas, and representative browser/device testing remain required implementation gates. The local scheduled two-hour access-expiry and cleanup path passed in `docs/spikes/0032-scheduled-privacy-maintenance.md`.
