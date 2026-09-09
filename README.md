# SEALPROOF

This directory contains the intentionally built, auditable version of SEALPROOF.

The first deliberately built interactive slice now lives in `src/app/`: typed production setup, local browser PDF generation, and exact-byte preview. The [Day 3 walking skeleton](prototypes/day3-walking-skeleton/index.html) remains a frozen behavioral reference rather than production code.

## Working rules

- `lovable-reference/` is reference material only. Code from it is not part of this application unless it is deliberately reviewed and adopted later.
- The walking skeleton remains a stable behavioral reference rather than accumulating production infrastructure.
- Production behavior replaces one documented fake at a time.
- Consequential technical choices receive a short decision record before implementation.
- Tests should demonstrate privacy, integrity, delivery, and deletion claims rather than relying on comments.

## Structure

```text
sealproof-app/
├── docs/          Product, data-lifecycle, threat, and decision records
├── prototypes/    Disposable or frozen interaction prototypes
├── src/           Future production implementation, grouped by responsibility
└── tests/         Future executable evidence for product claims
```

The production stack is TypeScript, React/Vite, Cloudflare Workers, D1, private R2, and Resend. The rationale and validation evidence begin in `docs/decisions/0001-runtime-and-services.md`; incomplete pieces remain explicitly proposed or isolated behind spike boundaries.

## Local full-stack runtime

Run `npm.cmd run dev:local` in PowerShell (`npm run dev:local` in Git Bash) to build the React app, apply migrations to isolated local D1, and serve the app plus Worker API over HTTPS at `https://localhost:8787`. This runtime uses synthetic keys and a local-only Turnstile substitute; its entry point rejects non-loopback hostnames and must never be used with real information.
