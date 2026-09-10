# 0044 — Live Browser Turnstile and Closeout Boundary

## Scope

Connect the production-shaped browser workflow without a Worker deployment or
private secret. Preserve the localhost-only synthetic workflow unchanged.

## Public configuration

The production Worker exposes only the public Turnstile site key and fixed
`release-finalization` action at exact-host `GET /api/public-config`. The browser
uses a strict runtime schema, omits credentials, rejects extra fields, and never
receives the Turnstile secret or any Resend, D1, R2, or encryption setting.

## Browser challenge

The React single-page application explicitly loads Cloudflare Turnstile only on
the exact final-PDF review screen outside loopback. The managed widget clears
its token on expiration, error, unmount, correction, or failed admission. The
seal action remains disabled without a current token. Localhost continues to
use its synthetic proof and never loads the live widget.

## Live custody language and state

The remote test interface now discloses encrypted temporary SealProof storage,
separate Resend deliveries, independent email-provider retention, and the
unconditional two-hour limit before upload. It instructs testers to use only
controlled addresses and synthetic contents.

After sealing, the browser checks the capability-authorized bounded status every
three seconds while delivery is pending. Delivered or failed states stop
polling and direct the signer to hand the device back. A distinct production
screen then offers eligible role-specific retry, browser-held download, and
verified SealProof closeout. Local fake-webhook controls remain loopback-only.

## Safety status

The configured site key is public. Its paired secret is not present in source,
configuration, tests, or chat. No live Turnstile request, PDF upload, email,
webhook, DNS change, Worker deployment, or secret installation occurred.

## Automated evidence

All 192 tests across 39 files passed. The TypeScript checks and Vite production
build also passed. Focused tests confirm the exact-host public endpoint exposes
only the approved site key and action, rejects extra response fields, sends no
browser credentials, and remains behind the complete production configuration
boundary.

## Manual regression evidence

The project owner completed the full loopback workflow after these shared React
changes. The local synthetic banner remained accurate, no Turnstile widget
loaded, exact-PDF local sealing succeeded, fake delivery controls behaved as
expected, closeout confirmed deletion, and reset cleared the workflow. The
request trace contained only localhost application routes and the local fake
webhook path. The local server was then stopped.

## Next gate

Prepare the private test secrets without exposing their values.
