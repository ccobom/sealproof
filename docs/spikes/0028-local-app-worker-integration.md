# 0028 — Local Application Worker Integration

- Date: September 9, 2026
- Result: Production-shaped local HTTP path connected

## Question

Can the disconnected browser transport traverse one application Worker router, anonymous admission, raw PDF finalization, encrypted D1 state, and ciphertext-only R2 storage without enabling a live UI or deployment?

## Router

The application Worker mounts exactly two release routes: `/api/releases/admissions` and `/api/releases/finalize`. Unknown API paths return a private, cache-disabled `404` and never reach the static asset binding. Non-API requests fall through to Cloudflare's static asset fetcher when configured.

The router owns no business rules. It delegates to the already-tested strict admission and finalization handlers, supplies Worker-owned time, and permits injection of the outbound fetch function solely so local tests can replace Cloudflare Turnstile Siteverify.

## Integrated evidence

The browser client generated an admission request using synthetic addresses, hash, and Turnstile proof. The router passed it through a fake successful Siteverify response and returned an encrypted ticket. The client then uploaded the exact generated PDF bytes using that ticket. The finalization coordinator created local D1 state and stored only application-encrypted ciphertext in local R2. The test inspected the object to confirm it did not begin with a PDF header, then ran the normal cleanup path.

Separate router tests confirmed unknown API paths fail closed and ordinary paths reach the asset binding.

## Scope

This integration runs inside the local Cloudflare test runtime. It uses a generated PDF, `example.invalid` addresses, deterministic test keys, local D1/R2, and a fake Turnstile response. The production React interface remains disconnected, and no live resource, credential, network call, storage, email, or personal information is involved.

## Next gate

Add local development configuration for this application Worker and exercise the built React app against it with synthetic inputs. The interface must remain visibly in test mode until Turnstile UI behavior, deployment configuration, and the remaining delivery/status routes have been reviewed.
