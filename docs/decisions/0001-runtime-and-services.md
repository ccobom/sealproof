# 0001 — Runtime and Services

- Status: Proposed
- Date: September 8, 2026
- Decision owner: Project owner
- Validation gate: TypeScript Worker PDF generation and hashing spike

## Context

SEALPROOF needs a small browser application and a trusted server boundary. The product collects sensitive personal information long enough to create and deliver an A/V release, but it is explicitly not a permanent document-management system.

The project owner initially preferred a Python and JavaScript foundation. After reviewing the browser/server boundary and Cloudflare runtime options, the project owner chose a single TypeScript application stack while preserving that boundary. The project priorities are:

- explicit types and runtime validation across browser/server communication;
- one primary language and dependency ecosystem;
- transparent, easily audited code;
- minimal operating costs outside Cloudflare;
- no mandatory user accounts;
- an unconditional two-hour maximum for SealProof-controlled PDF and PII retention.

The application must eventually generate one finalized PDF, hash its exact bytes, send separate copies to production and signer, track delivery outcomes, support retry using the same bytes, retain a minimal non-PII audit record, and delete temporary data.

## Proposed decision

### Frontend

Use React with TypeScript, built by Vite and served as Cloudflare Worker static assets.

React will manage only browser interaction: the multi-step workflow, role handoff, form state, photo capture, signature capture, progress, delivery-status display, and local download.

TypeScript will define explicit client-side data and state boundaries. Shared Zod schemas will provide TypeScript types and runtime validation for browser/server messages. Runtime input remains untrusted and must be validated again inside the Worker.

### Backend

Use TypeScript in a Cloudflare Worker.

The Worker will validate requests, authorize release capabilities, finalize PDFs, calculate and verify SHA-256 hashes, coordinate delivery and retry, receive authenticated webhooks, update audit state, and enforce cleanup.

Browser and Worker code share a language but not a trust level. Resend credentials, storage access, database bindings, and encryption keys exist only in the Worker environment.

### PDF and hashing

Use `pdf-lib` in the Worker to construct the final PDF from validated data and image bytes. Use Cloudflare's native Web Crypto API to calculate SHA-256 over the final PDF bytes.

The exact finalized bytes are the source of truth. The hash, both email attachments, any temporary R2 object, and any local download must all derive from those same bytes rather than independently regenerated documents.

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
- be deleted automatically no later than two hours after finalization, regardless of delivery state.

R2 is not approved for permanent release storage.

### Email delivery

Use Resend to send separate messages to the production and signer addresses.

Both messages must attach the same finalized PDF bytes. Each message receives its own provider ID and role-specific delivery status. Authenticated Resend webhooks will distinguish API acceptance, delivery, delay, permanent failure, and bounce.

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
- `pdf-lib` performance and output quality in the Workers runtime remain unproven.
- Browser and Worker code could be confused during review because they share a language; directory and import boundaries must make the trust boundary obvious.
- D1 may require a different concurrency design than PostgreSQL.
- Temporary R2 storage expands the sensitive-data surface and requires encryption, access control, expiry, and cleanup evidence.
- Resend may retain email messages and attachments independently of SealProof's two-hour deletion rule.
- Webhook delivery is asynchronous, may be duplicated, and may arrive after SealProof has deleted the PDF.

## Validation gate

Local validation evidence is recorded in `docs/spikes/0001-worker-pdf-hash.md`. PDF construction, image embedding, exact-byte SHA-256 verification, Worker-runtime execution, and dry-build size have passed. Production CPU usage against the selected Cloudflare plan remains unverified, so this decision remains **Proposed**.

Before this decision can become **Accepted**, a minimal technical spike must demonstrate that a local Cloudflare TypeScript Worker can:

1. generate a readable PDF from hardcoded release information;
2. embed a representative photo and signature;
3. calculate the PDF's SHA-256 hash;
4. independently recalculate and match that hash from the returned bytes;
5. run `pdf-lib` in the actual local Workers runtime rather than only in Node;
6. fit the Cloudflare plan's applicable CPU, memory, request, and output limits.

The spike will not contain real personal information, send email, write to D1, or retain a document.

## Acceptance criteria

After the spike, update this record to one of:

- **Accepted** — the proposed stack passed the validation gate;
- **Accepted with amendment** — a documented component, such as the PDF library or execution strategy, changed while retaining the overall architecture;
- **Rejected** — the proposed direction is not viable, with evidence and a replacement decision record.

No production stack is approved merely by creating this document.
