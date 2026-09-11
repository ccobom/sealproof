# How SealProof Works

Status: Living guide to the current test deployment, updated September 11, 2026.

This document explains the application in ordinary language. It describes the code that currently runs at `test.sealproof.app`; it is not a promise that every production-readiness task is finished.

## The short version

SealProof makes one exact PDF in the user's browser. The browser calculates its SHA-256 hash, and the Cloudflare Worker independently calculates the hash again. If the values match, the Worker encrypts the PDF, temporarily stores it, and submits the same decrypted bytes in two separate email requests: one for production and one for the signer. Resend reports what happened through signed webhooks. After confirmed delivery, production closes the release and SealProof deletes the encrypted PDF and temporary personal information.

```text
Production and signer
        |
        v
Browser (React + TypeScript)
  - gathers information
  - creates and displays the exact PDF
  - takes photo/signature input
  - calculates SHA-256
        |
        | HTTPS requests + Turnstile proof
        v
Cloudflare Worker (trusted application boundary)
  - validates every request
  - independently hashes the PDF
  - encrypts temporary sensitive data
  - controls state, delivery, retry, and deletion
        |
        +------> D1: encrypted temporary state + minimal audit state
        |
        +------> private R2: application-encrypted PDF ciphertext
        |
        +------> Resend: two separate emails containing the exact PDF
                       |
                       +------> production inbox
                       +------> signer inbox
                       |
                       +------> signed status webhooks back to Worker
```

## The moving pieces

| Piece | What it does | What it is trusted with |
|---|---|---|
| Browser application | Runs the visible release workflow, builds the PDF, shows it for review, hashes it, and displays delivery state | Form inputs, photo, signature, agreement, exact PDF, and temporary browser capabilities |
| Cloudflare Worker | Acts as SealProof's trusted server: validates requests, checks hashes, encrypts data, submits email, processes webhooks, and performs cleanup | Temporary PDF and email plaintext while actively processing, encryption keys, service secrets, and storage access |
| Cloudflare D1 | Stores the release state machine and audit evidence | Encrypted temporary email data, wrapped PDF key information, hashed browser capabilities, delivery attempts, and minimal audit fields |
| Cloudflare R2 | Temporarily stores the finalized document | Only application-encrypted PDF ciphertext; the bucket is private |
| Cloudflare Turnstile | Helps limit automated abuse of anonymous finalization | A challenge token plus normal anti-abuse request metadata; it does not receive the PDF |
| Resend | Sends the two recipient messages and reports delivery events | Recipient email address, email text, transaction information included in the message, and the PDF attachment |
| Recipient mail systems | Accept and retain the sent messages | Their recipient's message and PDF copy |
| Scheduled Worker cleanup | Enforces expiration even if the browser disappears | Transaction identifiers and temporary storage references needed to delete expired data |

## Start-to-finish narrative

### 1. Production prepares the release

Production enters the project and production information, the production email address, the agreement text, and whether a current signer photograph is required. The browser holds these values while the release is active.

Production can review the setup before the handoff. The photo choice is fixed before the device reaches the signer so that a camera failure cannot silently change the evidence rule later.

### 2. The device is handed to the signer

The browser shows an explicit handoff boundary. The signer reviews the production/project context and agreement, supplies their name, date, email address, consent, optional-or-required photograph, and drawn signature.

At this point the browser contains personal information. It has not received any Cloudflare or Resend secret; browser code is never treated as a trusted secret holder.

### 3. The browser creates the exact PDF

The React/TypeScript application uses `pdf-lib` to create the final document. The signer is shown that generated PDF for review. The PDF, rather than a second reconstruction of the form fields, becomes the source of truth.

The browser enforces the current product limits:

- no more than three pages; and
- no more than 60,000 bytes.

The browser calculates a SHA-256 digest of the exact PDF bytes. A hash is a fingerprint, not encryption: it helps detect any byte-level change but does not hide the document.

### 4. Turnstile authorizes one finalization attempt

Before uploading the PDF, the browser sends the Worker:

- the production and signer email addresses;
- the browser's document hash; and
- the Turnstile token.

The Worker checks the request's HTTPS origin, hostname, size, and Zod schema. It asks Turnstile to validate the anti-bot token for the expected hostname and action.

If accepted, the Worker returns a short-lived encrypted finalization ticket. That ticket binds the two email addresses, document hash, workflow version, and admission identifier together. It is encrypted and authenticated with a Worker-only key so the browser cannot alter its contents.

### 5. The browser submits the reviewed PDF

The browser uploads the PDF bytes with the finalization ticket in its authorization header. The Worker checks the hostname and origin again, opens the ticket, rejects replay, enforces the 60 KB upload boundary, and independently calculates SHA-256 over the received bytes.

If the Worker's hash does not match the browser hash sealed inside the ticket, finalization stops. SealProof does not call the contract sealed.

The Worker checks the PDF header but deliberately does not fully parse the PDF. Full server-side PDF parsing was avoided because it did not have dependable CPU margin on the intended Cloudflare Free plan. The signer-facing browser review is therefore an important part of the trust model.

### 6. The Worker encrypts temporary data

After hash agreement, the Worker creates a random data-encryption key for the PDF and encrypts the document with AES-GCM. It then encrypts (wraps) that random key with the versioned Worker key-encryption key.

The private R2 bucket receives only encrypted PDF ciphertext. D1 receives the metadata needed to authenticate and decrypt it later, including the wrapped data key. The two email addresses are also stored in an authenticated encrypted D1 envelope rather than plaintext.

The Worker stores only hashes of the browser's status and closeout/retry capabilities. A capability is a high-entropy random credential: possessing it authorizes a narrow action. Hashing the stored copy means a D1 disclosure alone does not reveal the usable browser credential.

### 7. The Worker submits two separate emails

The Worker retrieves the encrypted R2 object and verifies its recorded ciphertext size and SHA-256. It decrypts the PDF transiently and verifies the plaintext against the sealed document hash again.

The delivery coordinator then:

1. validates the PDF boundary and hash once more;
2. Base64-encodes the exact bytes once;
3. submits one Resend request for production;
4. submits a separate Resend request for the signer; and
5. gives every recipient attempt a deterministic idempotency key.

Both role-specific requests reuse the same immutable Base64 content. The PDF is not re-encoded for the second recipient.

Idempotency means that recovering the same interrupted attempt should not accidentally create a duplicate email. Production and signer still have independent message IDs and delivery states.

The Base64 text is transport encoding, not encryption. Resend decodes it into the PDF attachment. Resend necessarily receives the document and recipient address to deliver the email.

Mutable ciphertext and PDF byte arrays in the Worker are overwritten after processing. JavaScript strings created during Base64/JSON serialization cannot be explicitly overwritten, but they are transient and are not written to SealProof storage.

### 8. Resend reports delivery events

Resend sends webhook requests to `/api/webhooks/resend`. Each webhook includes a signature made with the Resend webhook secret. The Worker reads a strictly bounded body, verifies that signature before trusting the event, and then updates the matching provider message attempt.

Webhook events may be duplicated or arrive asynchronously. D1 constraints and event-processing rules prevent a duplicate from becoming a second delivery. Contradictory terminal evidence becomes `DELIVERY_UNRESOLVED`; SealProof does not guess.

The meanings are deliberately narrow:

- `PENDING`: submission or mail-server outcome is still unresolved;
- `DELIVERED`: the recipient's mail server accepted the message, not proof that the person read it;
- `FAILED`: Resend reported a permanent failure or bounce for that role; and
- `UNRESOLVED`: the authenticated evidence conflicts.

The overall release becomes `DELIVERED` only when both recipient roles are delivered.

### 9. The browser polls for status

The delivery screen periodically sends the transaction ID and status capability to the Worker. The Worker hashes the supplied capability and compares that hash with D1 before returning the document hash and role-level state.

The browser can therefore update from awaiting delivery to delivered or failed without receiving database credentials, Resend credentials, recipient addresses, storage keys, or encryption keys.

### 10. Failure and retry

If one recipient fails, the other role remains independent. After the device returns to production, the closeout/retry capability can authorize a retry for only the failed role. A retry uses the encrypted stored PDF; it never regenerates the contract.

Each role currently has one original attempt plus at most two retries. A retry does not extend the original expiration time. Submission failures are recorded as bounded categories rather than raw provider messages that might contain sensitive material.

### 11. Closeout and deletion

After delivery, production may download the still-present browser copy and then explicitly close the release. The browser sends an authenticated `DELETE` request using the closeout capability.

The Worker:

1. disables temporary access;
2. deletes the encrypted R2 object;
3. checks that the object is actually absent;
4. deletes the temporary D1 row, which also removes temporary addresses, capabilities, delivery-attempt identifiers, and encryption metadata; and
5. marks cleanup complete in the minimal audit record.

If explicit closeout never happens, access expires exactly two hours after finalization. The scheduled Worker runs every five minutes in the current test deployment and repeatedly attempts cleanup until it can confirm deletion. Expiration wins even if delivery is still pending.

The minimal audit record expires one year after successful cleanup. It contains evidence such as transaction ID, document hash, workflow version, final delivery outcomes, finalization/cleanup timestamps, cleanup outcome, and bounded failure category—not the agreement, PDF, names, email addresses, photograph, or signature.

Deleting SealProof's temporary copy cannot delete copies already delivered to inboxes or retained by Resend or recipient mail providers.

## What crosses each boundary

| Exchange | Information sent | Information deliberately not sent |
|---|---|---|
| Browser → Turnstile/Worker admission | Two email addresses, PDF hash, Turnstile token | PDF bytes and Worker secrets |
| Worker → Turnstile | Challenge verification data | PDF, agreement, photo, signature, and Resend secret |
| Worker → browser after admission | Encrypted finalization ticket and its expiry | Encryption keys, database access, and Resend credentials |
| Browser → Worker finalization | Exact PDF and encrypted ticket | Raw encryption keys and storage credentials |
| Worker → R2 | AES-GCM-encrypted PDF bytes | Plaintext PDF and recipient addresses |
| Worker → D1 temporary state | Encrypted addresses, wrapped PDF key, capability hashes, delivery state | Plaintext addresses, plaintext PDF, and usable browser capabilities |
| Worker → Resend | One recipient address, email text, exact Base64 PDF, idempotency key | Cloudflare storage credentials, encryption keys, other recipient's address, photo/signature outside the PDF |
| Resend → Worker webhook | Provider message ID, event type/time, signed event body | PDF attachment bytes |
| Browser → Worker status | Transaction ID and status capability | Email addresses and PDF |
| Browser → Worker retry/closeout | Transaction ID, closeout/retry capability, and role for retry | Encryption keys and direct D1/R2 access |

## Secrets and credentials

Never place actual secret values in this document, Git, screenshots, browser code, or chat.

| Name | Location | Purpose | Public? |
|---|---|---|---|
| `TURNSTILE_SITE_KEY` | Worker environment and browser public configuration | Identifies the Turnstile widget | Yes; designed to be public |
| `TURNSTILE_SECRET_KEY` | Cloudflare Worker secret | Lets the Worker verify Turnstile tokens | No |
| `RESEND_API_KEY` | Cloudflare Worker secret | Authorizes outgoing email submissions | No |
| `RESEND_WEBHOOK_SECRET` | Cloudflare Worker secret | Verifies that delivery events really came from Resend | No |
| `KEY_ENCRYPTION_KEY_BASE64` | Cloudflare Worker secret | Wraps per-release PDF keys and protects temporary email data | No |
| `TICKET_ENCRYPTION_KEY_BASE64` | Cloudflare Worker secret | Encrypts/authenticates finalization tickets | No |
| `PROVIDER_ATTACHMENT_KEYS_JSON` | Cloudflare Worker secret | Legacy key material from the retired URL-attachment design; still validated by current configuration but not used for new delivery submissions | No |
| Status capability | Browser memory; only its hash is in D1 | Reads one active release's status | Secret bearer credential |
| Closeout/retry capability | Browser memory; only its hash is in D1 | Authorizes retry and closeout for one active release | Secret bearer credential |

The PDF key and ticket key must be independent. Version labels make controlled key rotation possible, although the complete operational rotation and recovery procedure is still unfinished.

## Hashing versus encryption

These mechanisms solve different problems:

- **SHA-256 hashing** answers, “Are these exactly the same bytes?” Anyone with the document can calculate the same hash. It does not hide the document.
- **AES-GCM encryption** makes stored content unreadable without a key and detects tampering with the encrypted envelope.
- **Base64 encoding** changes binary bytes into text suitable for a JSON request. It provides no secrecy.
- **A capability** is an unguessable bearer credential granting one narrow permission. It is protected like a password while active.
- **A webhook signature** proves that a status event was signed with Resend's webhook secret and that its exact body was not altered.

## What has been demonstrated live

On September 10, 2026, a complete test release at `test.sealproof.app` demonstrated:

- browser PDF creation and review;
- independent browser and Worker SHA-256 agreement;
- encrypted temporary R2 storage;
- separate direct-content Resend submissions;
- successful arrival in both recipient inboxes;
- authenticated webhook updates to `DELIVERED` for both roles;
- independent SHA-256 verification of both downloaded attachments against the displayed sealed hash; and
- successful explicit closeout and deletion request.

The tested transaction ID and hash may be retained as non-PII technical evidence, but test email addresses and document contents should not be copied into documentation.

## Important unfinished work

The live happy path is real, but the application is still a test deployment. Before calling it production-ready, the project still needs deliberate work including:

- continued PDF-size monitoring whenever document layout, fonts, photography, or signature rendering changes;
- broader mobile, browser, accessibility, failure, concurrency, and hostile-input testing;
- final visual design and integration with the main `sealproof.app` site;
- DMARC configuration and final email deliverability review;
- final privacy disclosure covering Resend and recipient-provider retention;
- removal of retired provider-attachment configuration, code, columns, and secret after a safe compatibility review;
- documented secret rotation, incident response, and cleanup-failure alerting;
- final product/legal review of release language and claims; and
- a future decision about signer-controlled email opt-out, which must remain isolated from production and transparent about its consequences.

## Where to inspect the implementation

- `src/app/` — browser workflow and API clients
- `src/admission/` — Turnstile verification and encrypted finalization ticket
- `src/document/` — PDF rules, hashing, and Base64 conversion
- `src/crypto/` — temporary PDF and email encryption
- `src/release/` — finalization and stored release state
- `src/delivery/` — Resend submission, retries, webhook processing, and delivery state
- `src/http/` — authenticated HTTP boundaries
- `src/cleanup/` — explicit and scheduled deletion
- `src/worker/` — production/local composition and configuration checks
- `migrations/` — auditable D1 schema history
- `tests/` — executable behavior and security-boundary evidence
- `docs/decisions/` — architectural decisions and amendments
- `docs/spikes/` — narrowly scoped experiments and their evidence
