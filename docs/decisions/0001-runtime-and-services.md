# 0001 — Runtime and Services

- Status: Proposed
- Date: September 8, 2026
- Decision owner: Project owner
- Validation gate: PDF generation and hashing spike

## Context

SEALPROOF needs a small browser application and a trusted server boundary. The product collects sensitive personal information long enough to create and deliver an A/V release, but it is explicitly not a permanent document-management system.

The project owner prefers:

- a Python and JavaScript foundation;
- transparent, easily audited code;
- minimal operating costs outside Cloudflare;
- no mandatory user accounts;
- an unconditional two-hour maximum for SealProof-controlled PDF and PII retention.

The application must eventually generate one finalized PDF, hash its exact bytes, send separate copies to production and signer, track delivery outcomes, support retry using the same bytes, retain a minimal non-PII audit record, and delete temporary data.

## Proposed decision

### Frontend

Use React with TypeScript, built by Vite and served as Cloudflare Worker static assets.

React will manage only browser interaction: the multi-step workflow, role handoff, form state, photo capture, signature capture, progress, delivery-status display, and local download.

TypeScript will define explicit client-side data and state boundaries. Runtime input remains untrusted and must also be validated by the backend.

### Backend

Use Python with FastAPI in a Cloudflare Python Worker.

The backend will validate requests, authorize release capabilities, finalize PDFs, calculate and verify SHA-256 hashes, coordinate delivery and retry, receive authenticated webhooks, update audit state, and enforce cleanup.

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

- It preserves the requested Python and JavaScript foundation.
- It keeps hosting, compute, database, and optional object storage within Cloudflare.
- It avoids adopting Lovable's generated architecture merely because it already exists.
- It creates a clear trust boundary: the frontend gathers and displays; the backend validates and performs; durable storage remembers only approved evidence.
- D1 appears sufficient for a deliberately small transaction and audit schema.
- Resend is already available to the project and provides the required delivery webhooks.

## Alternatives considered

### Vanilla TypeScript instead of React

This would reduce dependencies. React is provisionally preferred because the application has a multi-step workflow, camera and signature components, distinct role states, and asynchronous delivery updates. React must remain small and must not import a generic component system by default.

### An all-TypeScript Cloudflare Worker

This would use one language across browser and server and may fit the Workers runtime more naturally. It remains the fallback if Python PDF generation is unsupported, unreliable, or too resource-intensive. Failure of the PDF spike does not automatically require replacing the React frontend or other Cloudflare services.

### Supabase-hosted PostgreSQL

PostgreSQL provides strong portability and transactional behavior. D1 is provisionally preferred for lower cost and fewer external services. This choice must be revisited if D1 cannot enforce the required idempotency, transaction, or audit constraints cleanly.

### No temporary object storage

Generating and sending a PDF entirely in one request would minimize custody. The approved retry workflow requires the exact same PDF bytes after an initial delivery failure, so temporary storage may be necessary. The implementation should still prove whether R2 can be avoided before adopting it.

## Consequences and risks

- The application becomes coupled to Cloudflare Workers bindings and D1.
- Python and TypeScript create two dependency ecosystems and two runtime type definitions that must remain aligned.
- Python package compatibility and CPU limits in Cloudflare Workers may constrain PDF generation.
- D1 may require a different concurrency design than PostgreSQL.
- Temporary R2 storage expands the sensitive-data surface and requires encryption, access control, expiry, and cleanup evidence.
- Resend may retain email messages and attachments independently of SealProof's two-hour deletion rule.
- Webhook delivery is asynchronous, may be duplicated, and may arrive after SealProof has deleted the PDF.

## Validation gate

Before this decision can become **Accepted**, a minimal technical spike must demonstrate that a local Cloudflare Python Worker can:

1. generate a readable PDF from hardcoded release information;
2. embed a representative photo and signature;
3. calculate the PDF's SHA-256 hash;
4. independently recalculate and match that hash from the returned bytes;
5. run using packages supported by Cloudflare Python Workers;
6. fit the Cloudflare plan's applicable CPU, memory, request, and output limits.

The spike will not contain real personal information, send email, write to D1, or retain a document.

## Acceptance criteria

After the spike, update this record to one of:

- **Accepted** — the proposed stack passed the validation gate;
- **Accepted with amendment** — a documented component, such as PDF generation, moved to TypeScript;
- **Rejected** — the proposed direction is not viable, with evidence and a replacement decision record.

No production stack is approved merely by creating this document.
