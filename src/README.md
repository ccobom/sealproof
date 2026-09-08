# Production Source

This directory contains only code admitted through an approved validation gate.

The first code is an isolated PDF-and-hash spike:

- `document/` constructs synthetic image fixtures, builds a sample PDF, and hashes its exact bytes;
- `worker/` exposes that spike at `GET /spike/document` in the Cloudflare Workers runtime.

The spike contains no real personal information, persistence, email, or production workflow behavior.

The provisional responsibility boundaries are:

- `release/` — orchestration of the release workflow;
- `document/` — deterministic document construction and hashing;
- `delivery/` — delivery requests and provider responses;
- `audit/` — minimal approved audit evidence;
- `cleanup/` — retention and deletion enforcement.

These remain responsibility boundaries rather than permission to build every subsystem. Add implementation directories only as their first approved vertical slice is built.
