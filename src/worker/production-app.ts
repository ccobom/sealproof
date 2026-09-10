import { createSealProofWorker } from "./app";
import { createProductionDeliveryHandlers } from "./production-delivery";
import { handleResendWebhookRequest } from "../http/resend-webhook-route";
import type { ProductionDeliveryEnvironment } from "./production-delivery";
import { handlePublicConfigRequest } from "../http/public-config-route";
import {
  validCleanupBindings,
  validProductionConfiguration,
} from "./production-configuration";

type NetworkFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface ProductionEnvironment extends ProductionDeliveryEnvironment {
  RESEND_WEBHOOK_SECRET: string;
  TURNSTILE_SITE_KEY: string;
}

export interface ProductionWorkerDependencies {
  fetcher?: NetworkFetcher;
  now?: () => number;
}

export function createProductionWorker(dependencies: ProductionWorkerDependencies = {}) {
  const now = dependencies.now ?? Date.now;
  const delivery = createProductionDeliveryHandlers(dependencies.fetcher);
  const application = createSealProofWorker({
    fetcher: dependencies.fetcher,
    now,
    afterSealed: delivery.afterSealed,
    retryDelivery: delivery.retryDelivery,
  });
  return {
    async fetch(request: Request, environment: ProductionEnvironment): Promise<Response> {
      const path = new URL(request.url).pathname;
      if (path.startsWith("/api/") && !validProductionConfiguration(environment)) {
        return Response.json({ error: "SERVICE_UNAVAILABLE" }, {
          status: 503,
          headers: {
            "cache-control": "private, no-store, max-age=0",
            pragma: "no-cache",
            "x-content-type-options": "nosniff",
          },
        });
      }
      if (path === "/api/public-config") {
        return handlePublicConfigRequest(request, environment);
      }
      if (path === "/api/webhooks/resend") {
        return handleResendWebhookRequest(request, environment, now());
      }
      return application.fetch(request, environment);
    },
    scheduled(
      controller: ScheduledController,
      environment: ProductionEnvironment,
      context: ExecutionContext,
    ): void {
      if (validCleanupBindings(environment)) {
        application.scheduled(controller, environment, context);
      }
    },
  } satisfies ExportedHandler<ProductionEnvironment>;
}

export default createProductionWorker();
