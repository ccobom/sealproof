# SEALPROOF

This directory contains the intentionally built, auditable version of SEALPROOF.

The current runnable artifact is the [Day 3 walking skeleton](prototypes/day3-walking-skeleton/index.html). It is an interaction prototype, not the production application. Its simulated behavior is labeled in the interface and documented in `make-and-do/03-PATH.md`.

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

No production technology stack has been selected yet.
