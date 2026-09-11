# Decision Records

Use this directory for short records of consequential technical decisions.

Name records sequentially, for example `0001-runtime-and-hosting.md`. Each record should state:

- the decision being made;
- the constraints and evidence;
- alternatives considered;
- the selected option and why;
- privacy, security, and operational consequences;
- the date and approval status.

Current records:

- `0001-runtime-and-services.md` — accepted with amendment;
- `0002-release-state-and-audit-data.md` — proposed, with its local validation gates completed incrementally; and
- `0003-http-finalization-boundary.md` — proposed; Zod approved, multipart transport rejected by its remote CPU gate; and
- `0004-temporary-pdf-encryption.md` — accepted for implementation, with its isolated cryptographic gate passed; and
- `0005-anonymous-admission-and-abuse-control.md` — accepted for incremental implementation; anonymous use with Turnstile and layered limits;
- `0006-provider-attachment-access.md` — superseded by the direct-content attachment decision;
- `0007-direct-resend-attachments.md` — accepted for controlled test deployment; and
- `0008-free-plan-document-and-photo-limits.md` — accepted; evidence-backed 60 KB PDF and 35/40 KB photograph limits; and
- `0009-retire-provider-attachment-runtime.md` — accepted for staged removal of the superseded attachment-URL runtime and secret.
