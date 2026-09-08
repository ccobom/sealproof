# 0001 — Worker PDF and Hash Spike

- Date: September 8, 2026
- Result: Partial pass; production CPU measurement remains open
- Related decision: `docs/decisions/0001-runtime-and-services.md`

## Question

Can a local Cloudflare TypeScript Worker use `pdf-lib` to construct a readable PDF containing representative synthetic photo and signature images, calculate SHA-256 over its exact bytes, and return those same bytes for independent verification?

## Scope

The spike uses only hardcoded, synthetic data. It does not use React, accept form input, send email, connect to D1 or R2, persist a PDF, or contain any real personal information.

The only Worker route is `GET /spike/document`. It returns the generated PDF and places its SHA-256 value in the `x-sealproof-sha256` response header. All other routes return `404`.

## Evidence

On September 8, 2026:

- both production and test TypeScript checks passed;
- Cloudflare's Vitest plugin ran the tests in its local Workers runtime;
- 2 of 2 tests passed;
- `pdf-lib` created a PDF containing a generated JPEG photo and PNG signature;
- `pdf-lib` loaded the returned bytes as a readable one-page PDF;
- an independent SHA-256 calculation over the returned bytes matched the Worker's header;
- a Wrangler dry build passed without deploying;
- the dry-build upload was 839.48 KiB uncompressed and 217.94 KiB gzip;
- Wrangler found no Cloudflare service bindings;
- npm audited 91 installed packages and reported zero known vulnerabilities.

### Preliminary local CPU measurement

After moving synthetic image creation outside the request handler, a local `workerd` process-level benchmark sent five warmed batches of 100 identical requests. Average CPU time per request was:

| Batch | CPU time per request |
| --- | ---: |
| 1 | 9.375 ms |
| 2 | 14.062 ms |
| 3 | 9.219 ms |
| 4 | 10.625 ms |
| 5 | 11.250 ms |
| **Mean** | **10.906 ms** |

An equal-length idle measurement recorded no additional `workerd` CPU time. A DevTools Performance recording displayed a 5.85-second asynchronous `crypto.subtle.digest()` span even though the complete request finished in 35 ms; because those values are physically inconsistent, that trace is not treated as an accurate CPU measurement.

The process-level benchmark is useful screening evidence, not Cloudflare production billing data. It includes local runtime behavior and operating-system accounting, and its mean sits too close to the Workers Free 10 ms limit to establish compliance.

### JPEG optimization pass

The DevTools bottom-up view identified PNG decoding and deflate compression as the meaningful visible JavaScript work. The displayed 5.29-second Web Crypto digest duration remained incompatible with the request's 35 ms end-to-end duration and was rejected as a measurement artifact.

The spike then changed the representative photo from a generated PNG to a pre-generated 1280 by 960 JPEG while retaining a 300 by 80 PNG signature. Synthetic fixture construction occurs outside the request handler. Five warmed batches of 100 requests produced:

| Batch | CPU time per request |
| --- | ---: |
| 1 | 7.969 ms |
| 2 | 7.812 ms |
| 3 | 12.188 ms |
| 4 | 9.219 ms |
| 5 | 9.375 ms |
| **Mean** | **9.313 ms** |

This is approximately 14.6% lower than the PNG-photo baseline mean. The resulting PDF was 40,952 bytes. The revised dry-build upload was 879.13 KiB uncompressed and 237.51 KiB gzip, still far below the Worker-size limit.

The mean is below 10 ms, but the variance and lack of production-equivalent accounting leave insufficient margin to approve the Workers Free CPU gate.

Commands:

```text
npm run check
npm test
npx wrangler deploy --dry-run --outdir .wrangler/dry-run
```

## Dependency and tooling notes

- Runtime dependency: `pdf-lib` 1.17.1.
- Development dependencies: Cloudflare Vitest plugin 1.1.6, TypeScript 6.0.3, Vitest 4.1.0, and Wrangler 4.130.0.
- TypeScript 7.0.2 produced incompatibilities in third-party Cloudflare and Vitest declaration files, so the spike pins the prior stable TypeScript 6.0.3 release.
- The test-only TypeScript configuration uses `skipLibCheck` because current Cloudflare and Vitest declaration files conflict. Production source does not use `skipLibCheck`.
- Wrangler-generated `worker-configuration.d.ts` replaces the standalone `@cloudflare/workers-types` package.
- npm reported that install scripts for `esbuild` and `workerd` were not approved. The type checks, Worker-runtime tests, and dry build succeeded without approving them.
- Wrangler displayed a notice that it collects anonymous usage telemetry. No decision to enable or disable that developer-tool telemetry is recorded yet.

## Remaining gate

The bundle is well below Cloudflare's 64 MiB Worker-size limit and the test document is well below the 128 MB runtime memory ceiling. The Workers Free plan currently permits only 10 ms of CPU time per HTTP request.

Local wall-clock and process-level timing are not authoritative Cloudflare CPU measurements. After JPEG optimization, the local mean was 9.313 ms per request, with one batch above the Workers Free 10 ms limit. Before accepting the architecture decision, either create additional safety margin or run the synthetic endpoint in a non-production Cloudflare preview or deployment and inspect its CPU usage. Representative production-size inputs must then be confirmed against the selected plan's limit. Remote validation requires a separate approval because it creates Cloudflare state.

## Conclusion

The core library and byte-integrity approach pass locally in the intended runtime. The architecture decision remains **Proposed** until the Cloudflare CPU-limit check is completed or the execution strategy is amended.
