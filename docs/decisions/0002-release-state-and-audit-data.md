# 0002 — Release State and Audit Data

- Status: Proposed
- Date: September 8, 2026
- Decision owner: Project owner
- Validation gate: Local D1 migration and state-transition tests using synthetic data

## Context

SEALPROOF must coordinate two separate email deliveries, retries, downloads, explicit closeout, and unconditional deletion no later than two hours after finalization. Resend webhooks are delivered at least once, may be duplicated, and may arrive out of order. The application therefore needs durable operational state without turning the audit record into permanent storage for personal information.

The finalized PDF already contains the release text, names, date, photo, and signature. Keeping separate server-side copies of those inputs after finalization would increase exposure without supporting an approved product behavior.

## Proposed decision

Use Cloudflare D1 for three deliberately separate kinds of records:

1. a short-lived temporary release row containing only data needed during the two-hour delivery window;
2. delivery attempts and webhook identifiers needed for correct, duplicate-safe state changes;
3. a minimal audit row that remains after temporary data is deleted.

Use private R2 only for the exact finalized PDF bytes. D1 stores the R2 object key, never the PDF itself.

### Identifier rules

- Generate a random transaction ID for each finalized release.
- Generate independent high-entropy capabilities for status, download, and provider attachment access.
- Store only SHA-256 digests of status and download capabilities in D1.
- Never use an email address, name, project title, sequential number, or document hash as an authorization credential.
- A transaction ID identifies a release but does not authorize access to it.

### Temporary release record

The temporary record may contain:

| Field | Purpose | Deletion rule |
|---|---|---|
| Transaction ID | Join to audit and delivery state | Retained in audit |
| Production email | Initial delivery and retry | Delete on closeout or expiry |
| Signer email | Initial delivery and retry | Delete on closeout or expiry |
| Private R2 object key | Retrieve the exact PDF | Delete with temporary row |
| Status capability digest | Authorize status polling | Delete with temporary row |
| Download capability digest | Authorize local download | Delete with temporary row |
| Finalization and expiry timestamps | Enforce the two-hour deadline | Finalization may remain in audit; expiry is temporary |

The temporary row does not contain separate names, project information, agreement text, photo bytes, or signature data. The browser must discard its structured inputs when the release closes.

### Approved temporary-PII encryption requirement

Application-level encryption is required for temporary email addresses in addition to Cloudflare's managed encryption at rest.

- Generate a new random 256-bit data-encryption key for every finalized release.
- Encrypt both email addresses together in one versioned AES-256-GCM envelope.
- Bind the ciphertext to the transaction ID and envelope version using authenticated additional data.
- Wrap the per-release data key with a versioned key-encryption key available only to the Worker as a Cloudflare secret.
- Use independent cryptographically random nonces for envelope encryption and key wrapping; never reuse a nonce with the same key.
- Store only ciphertext, nonces, the wrapped data key, and the non-secret key version in D1. Never store the plaintext addresses or the unwrapped data key.
- Do not place plaintext addresses, keys, ciphertext, or raw capabilities in application logs or error reports.
- Cleanup deletes the encrypted envelope and wrapped per-release key. This makes the temporary addresses unavailable even though the longer-lived Worker key-encryption key remains.
- Key rotation must retain an old key-encryption key only while an unexpired temporary row still references its version. New releases always use the current version.
- Authentication failure must fail closed without attempting delivery, retry, or returning partially decrypted data.

This design reduces exposure from a database disclosure and supports cryptographic deletion of each temporary envelope. It does not protect data from a fully compromised running Worker that can access the active key-encryption key.

### Minimal audit record

The retained audit record contains only:

- transaction ID;
- finalization timestamp;
- SHA-256 document hash and algorithm identifier;
- workflow/template version;
- role-specific final delivery outcome;
- non-sensitive failure category when applicable;
- closeout reason;
- cleanup completion timestamp and cleanup outcome.

It does not contain email addresses, names, agreement text, project details, R2 keys, raw capabilities, IP addresses, photo data, signature data, PDF bytes, or webhook payloads.

Resend provider message IDs are pseudonymous rather than anonymous: they may provide a path back to provider-held recipient information. Retaining them after closeout is therefore not approved by this decision. Unless a later decision establishes a necessary retention period, delete provider message IDs during cleanup while retaining only role-specific outcomes.

### Approved audit-retention period

Retain the minimal audit record for one year after successful or terminal cleanup, then delete it automatically.

For deterministic implementation, this decision defines one year as 365 days (`31,536,000,000` milliseconds) after `cleanup_completed_at`.

- The one-year clock begins at `cleanup_completed_at`, not finalization.
- A scheduled process must delete expired audit rows; application code must not rely on eventual manual cleanup.
- Audit expiry must be stored as an explicit timestamp calculated when cleanup completes.
- Deletion must be idempotent and must not create a replacement record containing the deleted audit values.
- Aggregate operational metrics may outlive individual audit rows only when they cannot identify or single out a transaction or participant.
- This is a provisional product period, not a claim about a universal legal requirement. Review it before public production use if qualified legal advice or a demonstrated customer requirement establishes a different necessary period.

The parties retain their own PDF and emailed document hash. The one-year SealProof audit record is supplemental evidence and operational support data rather than the only means of retaining the agreement.

## State model

### Release state

```text
CREATING
→ SIGNING
→ FINALIZING
→ SEALED_AWAITING_DELIVERY
→ DELIVERED or DELIVERY_FAILED
→ CLOSED
```

- `CREATING` and `SIGNING` are browser workflow states and do not require durable server records.
- The first durable release state is created during `FINALIZING`.
- `SEALED_AWAITING_DELIVERY` means the Worker independently hashed and stored the exact signer-approved PDF bytes and delivery attempts exist for both roles.
- `DELIVERED` means both role-specific deliveries reached `DELIVERED`.
- `DELIVERY_FAILED` means at least one role has a terminal failure while the release remains open for retry or download-and-delete.
- `CLOSED` means access and retry are disabled and SealProof-controlled PDF and PII deletion has completed or a non-PII cleanup failure has been recorded for intervention.

Overall delivery state should be derived from the two current role-specific delivery states rather than maintained as an independently mutable source of truth.

### Role-specific delivery state

```text
PENDING_SUBMISSION
→ ACCEPTED
→ DELAYED
→ DELIVERED
  or
→ FAILED
```

- API acceptance creates `ACCEPTED`; it is not delivery.
- `DELAYED` remains pending and can later become `DELIVERED` or `FAILED`.
- A bounce is recorded as `FAILED` with a bounded failure category.
- Retry creates a new delivery-attempt row for the failed role. It does not overwrite the prior attempt or regenerate the PDF.
- The current role outcome is derived from its ordered attempts.
- Provider events that would move an attempt backward, such as `sent` arriving after `delivered`, are recorded as processed but do not downgrade state.
- If one attempt receives both `DELIVERED` and a terminal failure event, its outcome becomes `UNRESOLVED_CONFLICT` regardless of arrival order. SealProof does not guess which event is authoritative.
- `UNRESOLVED_CONFLICT` cannot transition back to `DELIVERED` or `FAILED` automatically.

### Approved conflicting-event behavior

When a delivery attempt reaches `UNRESOLVED_CONFLICT`:

- the interface says **Delivery status could not be confirmed**;
- overall release delivery is unresolved rather than delivered or failed;
- SealProof does not retry automatically because the original message may have arrived;
- the user may download and delete the exact PDF;
- the original two-hour expiry remains unchanged and always deletes the temporary data;
- cleanup retains only the bounded audit category `conflicting_provider_events`, never webhook payloads, addresses, provider IDs, or event details.

Late non-terminal events such as `sent` or `delivery_delayed` are processed idempotently but never move a terminal outcome backward. Provider event timestamps may be retained during the temporary window for diagnosis, but arrival order and timestamps do not override the explicit conflict rule.

### Approved retained failure categories

The one-year minimal audit record may retain at most one of these bounded categories:

```text
delivery_bounced
provider_submission_failed
expired_delivery_unresolved
conflicting_provider_events
cleanup_failed
unknown_failure
```

Application code maps provider and internal errors to this closed list. It never stores provider error messages, exception messages, webhook payloads, recipient addresses, or arbitrary text in the audit record. An unfamiliar condition maps to `unknown_failure` until a later reviewed migration deliberately adds another category.

## Webhook processing rules

For every webhook request, the Worker must:

1. read the unmodified request body;
2. verify the Resend/Svix signature and timestamp before parsing or acting;
3. reject unverified, stale, malformed, or unsupported events;
4. use the `svix-id` as the idempotency key;
5. identify the delivery attempt by provider message ID;
6. atomically record the webhook ID and apply the allowed state transition;
7. return success for an already-processed valid webhook without applying it twice;
8. avoid storing the webhook payload or recipient address in the audit record.

The D1 spike must demonstrate that concurrent duplicate handling cannot apply one event twice. If D1 cannot provide the required atomic behavior clearly, this decision must be amended before deployment.

## Expiry and cleanup rules

- Set `expires_at` at finalization and never extend it. It must be no later than two hours after `finalized_at`.
- Explicit closeout and download-and-delete initiate cleanup immediately.
- A scheduled cleanup process handles abandoned browser sessions and always applies regardless of delivery state.
- Cleanup deletes the private R2 object first, then deletes temporary D1 PII and capability data.
- Retry and download authorization fail closed once cleanup begins or expiry is reached.
- Cleanup is idempotent: repeated execution treats an already-absent R2 object and already-removed temporary row as success.
- The audit row records completion only after SealProof-controlled PDF and temporary PII are confirmed absent.
- A cleanup failure records only transaction ID, stage, bounded error category, and timestamp. It must not copy the failed data into logs or the audit row.

## Transaction boundaries to validate

The implementation must prove the following operations are atomic or safely resumable:

- creating the audit row, temporary row, and two initial delivery-attempt rows;
- accepting a unique verified webhook and changing its delivery attempt;
- creating a retry attempt without duplicating an already-requested retry;
- marking cleanup in progress before invalidating capabilities;
- completing cleanup without falsely claiming deletion.

Network calls to R2 and Resend cannot participate in a D1 transaction. Each workflow must therefore be idempotent and recover safely after failure between database and network operations.

## Security and privacy consequences

- D1 temporarily contains two email addresses, so database access is part of the sensitive-data boundary.
- Provider-managed encryption at rest alone does not prevent a compromised Worker from reading temporary data. The approved application-level envelope limits database-disclosure risk, but a fully compromised running Worker could still access active key material.
- Hashing a capability protects it in D1, but the raw capability remains a bearer credential in the browser or provider request and must not be logged deliberately.
- Permanent provider message IDs could reconnect the audit row to PII and are therefore deleted by default.
- A non-PII audit record can prove byte identity and system actions; it cannot prove that an email recipient was the intended human or that they read the message.

## Alternatives considered

### Store all release fields in D1

Rejected for the first release. The PDF already contains those values, and duplicating them increases the number of sensitive copies and cleanup paths.

### Keep no durable temporary state

Rejected because delivery webhooks, retry, abandoned sessions, and automatic expiry continue after the initiating browser request ends.

### Store temporary state only in R2

Not selected. It obscures relational constraints, webhook idempotency, and role-specific attempt history that D1 can express and test more transparently.

### Retain Resend provider IDs permanently

Not selected without a demonstrated audit need because those identifiers may link the retained record back to provider-held recipient information.

## Validation gate

Before acceptance, a local synthetic D1 spike must demonstrate:

1. schema constraints for roles, states, hash format, and timestamps;
2. creation of one release with exactly two initial role deliveries;
3. duplicate webhook idempotency;
4. protection against backward state transitions;
5. independent production and signer outcomes;
6. retry as a new attempt using the same transaction and document hash;
7. expiry overriding every non-closed state;
8. idempotent cleanup;
9. removal of emails, capabilities, R2 keys, and provider IDs at cleanup;
10. retention of only the approved minimal audit fields.

## Open decisions requiring owner approval

None within this decision. Acceptance still requires the executable validation gate.

## Approval record

- Approved by: Project owner (all policy choices in this proposed decision)
- Date: September 8, 2026
- Notes: Application-level encryption for temporary email addresses, automatic deletion of minimal audit records one year after cleanup, fail-ambiguous handling of contradictory terminal delivery events, and the closed retained failure-category list are approved. The overall decision remains proposed until the D1 validation gate passes.
