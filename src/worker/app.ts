import {
  handleAdmissionRequest,
  type AdmissionRouteEnvironment,
} from "../admission/admission-route";
import {
  handleTicketFinalizationRequest,
  type SealedReleaseHandler,
  type TicketFinalizationEnvironment,
} from "../http/ticket-finalization-route";
import { handleReleaseStatusRequest } from "../http/release-status-route";
import { handleCloseoutReleaseRequest } from "../http/closeout-release-route";
import { runScheduledMaintenance } from "../cleanup/scheduled-maintenance";
import {
  handleProviderAttachmentRequest,
  type ProviderAttachmentEnvironment,
} from "../http/provider-attachment-route";

const PRIVATE_RESPONSE_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
} as const;

export interface SealProofEnvironment
  extends AdmissionRouteEnvironment, TicketFinalizationEnvironment, ProviderAttachmentEnvironment {
  ASSETS?: { fetch(request: Request): Promise<Response> };
}

type NetworkFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface SealProofWorkerDependencies {
  fetcher?: NetworkFetcher;
  now?: () => number;
  afterSealed?: SealedReleaseHandler;
}

export function createSealProofWorker(dependencies: SealProofWorkerDependencies = {}) {
  const fetcher = dependencies.fetcher ?? fetch;
  const now = dependencies.now ?? Date.now;

  return {
    async fetch(request: Request, environment: SealProofEnvironment): Promise<Response> {
      const path = new URL(request.url).pathname;
      if (path === "/api/releases/admissions") {
        return handleAdmissionRequest(request, environment, now(), fetcher);
      }
      if (path === "/api/releases/finalize") {
        return handleTicketFinalizationRequest(
          request, environment, now(), dependencies.afterSealed,
        );
      }
      if (/^\/api\/releases\/[A-Za-z0-9_-]{16,128}\/status$/.test(path)) {
        return handleReleaseStatusRequest(request, environment, now());
      }
      if (/^\/api\/releases\/[A-Za-z0-9_-]{16,128}$/.test(path)) {
        return handleCloseoutReleaseRequest(request, environment, now());
      }
      if (/^\/api\/provider\/attachments\/[A-Za-z0-9._-]{1,2048}$/.test(path)) {
        return handleProviderAttachmentRequest(request, environment, now());
      }
      if (path.startsWith("/api/")) {
        return Response.json({ error: "NOT_FOUND" }, {
          status: 404,
          headers: PRIVATE_RESPONSE_HEADERS,
        });
      }
      if (environment.ASSETS) return environment.ASSETS.fetch(request);
      return new Response("Not found", { status: 404 });
    },
    scheduled(
      controller: ScheduledController,
      environment: SealProofEnvironment,
      context: ExecutionContext,
    ): void {
      context.waitUntil(runScheduledMaintenance(environment, controller.scheduledTime));
    },
  } satisfies ExportedHandler<SealProofEnvironment>;
}

export default createSealProofWorker();
