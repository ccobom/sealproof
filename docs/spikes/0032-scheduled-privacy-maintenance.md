# 0032 — Scheduled Privacy Maintenance

- Date: September 9, 2026
- Result: Local scheduled cleanup path connected

## Question

Can SealProof end temporary access at the immutable two-hour deadline and repeatedly remove expired ciphertext, temporary personal-information state, and later-expired audit records without relying on the initiating browser?

## Schedule and guarantees

The application Worker now exposes a `scheduled()` handler backed by an every-minute Cron Trigger. Capability-authorized queries already require `expires_at > now`, so status, download, and retry access ends at the exact two-hour timestamp even before cleanup runs.

Each sweep selects at most 100 due releases. For every selected release, the existing idempotent coordinator invalidates access, deletes the R2 ciphertext, confirms absence, deletes temporary D1 state, and then marks the minimal audit record closed. A failed deletion retains its bounded failure marker and expired temporary row, so every subsequent minute sweep selects it again. Delivery state never extends the deadline.

The same scheduled pass deletes minimal audit rows whose independent one-year deadline has arrived. Its returned summary contains counts only and no transaction identifiers, addresses, provider data, storage keys, or exception text.

## Honest timing boundary

Cloudflare Cron Triggers operate at one-minute granularity and infrastructure execution can be delayed. SealProof therefore guarantees authorization expiry at two hours in its own logic, schedules physical deletion immediately after expiry, verifies deletion before claiming cleanup, and retries every minute until confirmed. It must not claim that distributed physical deletion is guaranteed at the exact two-hour millisecond.

Durable Object alarms were considered. They add another stateful service and cost surface while Cloudflare documents that alarms may also be delayed by up to a minute. The recurring sweep is simpler and has the useful property that retries continue beyond an alarm's bounded automatic retry series.

## Scope and evidence

Tests use generated PDFs, synthetic addresses, deterministic keys, and local D1/R2. They prove cleanup at the exact expiry boundary, preservation of a newer release, and deletion of a minimal audit row at its one-year boundary. The local Wrangler configuration registers the minute cron and supports manual invocation through Wrangler's local scheduled-event endpoint. Nothing was deployed and no live service was called.

The built local Worker configuration passed Wrangler's bundle dry run with the D1, R2, asset, and every-minute trigger bindings. A manual HTTPS invocation of Wrangler's local scheduled-event endpoint returned `outcome: ok` with retries enabled, confirming the exported scheduled handler is connected through the runtime.

## Capacity boundary

One invocation processes at most 100 releases to bound work. At sustained traffic above that cleanup capacity, the system must reject new admissions or increase safely measured cleanup capacity before production; it must never silently accumulate an expiry backlog.

## Next gate

Add admission-side capacity protection before production deployment, then repeat scheduled cleanup against production-shaped bindings during the eventual deployment gate.
