# 0029 — Local Full-Stack Runtime

- Date: September 9, 2026
- Result: Local HTTPS runtime configured; interactive finalization remains disconnected

## Question

Can SealProof serve its real React build and production-shaped API router together with local D1 and R2 while preserving the production HTTPS and same-origin checks?

## Configuration

`wrangler.local.jsonc` serves the built React assets and runs the application Worker at `https://localhost:8787`. It binds a local-only D1 database and R2 bucket. The setup command applies the repository's versioned migrations before starting the server.

The local entry point injects a synthetic successful Turnstile result so future browser integration can be exercised without a live Siteverify call. All configured keys and values are deterministic synthetic fixtures. They are not production credentials and must never protect real information.

## Deployment guard

The local entry point rejects every request whose hostname is not `localhost`, `127.0.0.1`, or the IPv6 loopback address. An accidental deployment therefore cannot serve the app or accept API requests. Production will use the separate application entry point and reviewed secret bindings.

Local development uses HTTPS instead of weakening the route's HTTPS and exact-origin requirements. The browser may require explicit acceptance of Wrangler's local development certificate.

## Data boundary

Local D1 and R2 data live under Wrangler's ignored `.wrangler/` directory. `.dev.vars` variants are also ignored before any real local secrets are introduced. The current React interface remains visibly in test mode and cannot invoke finalization, so this change stores no release data by itself.

## Usage

Run `npm.cmd run dev:local` from PowerShell, or `npm run dev:local` from Git Bash. The command builds the React app, applies all migrations to local D1, and starts the HTTPS Worker at `https://localhost:8787`.

## Next gate

Add the final-review action, synthetic local Turnstile proof, explicit local sealing state, and an immediate closeout path as one tested UI slice. Do not connect production Turnstile or deploy the application configuration in that slice.
