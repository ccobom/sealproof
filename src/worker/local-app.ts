import { createSealProofWorker, type SealProofEnvironment } from "./app";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

const localWorker = createSealProofWorker({
  fetcher: async () => Response.json({
    success: true,
    hostname: "localhost",
    action: "release-finalization",
  }),
});

export function isLocalRequest(request: Request): boolean {
  return LOCAL_HOSTNAMES.has(new URL(request.url).hostname);
}

export default {
  async fetch(request: Request, environment: SealProofEnvironment): Promise<Response> {
    if (!isLocalRequest(request)) {
      return Response.json({ error: "LOCAL_BUILD_ONLY" }, {
        status: 503,
        headers: { "cache-control": "private, no-store, max-age=0" },
      });
    }
    return localWorker.fetch(request, environment);
  },
} satisfies ExportedHandler<SealProofEnvironment>;
