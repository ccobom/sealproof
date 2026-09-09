import { createSealProofWorker } from "./app";
import { createProductionDeliveryHandlers } from "./production-delivery";
import { handleResendWebhookRequest } from "../http/resend-webhook-route";
import type { ProductionDeliveryEnvironment } from "./production-delivery";

type NetworkFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface ProductionEnvironment extends ProductionDeliveryEnvironment {
  RESEND_WEBHOOK_SECRET: string;
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
      if (new URL(request.url).pathname === "/api/webhooks/resend") {
        return handleResendWebhookRequest(request, environment, now());
      }
      return application.fetch(request, environment);
    },
    scheduled(
      controller: ScheduledController,
      environment: ProductionEnvironment,
      context: ExecutionContext,
    ): void {
      application.scheduled(controller, environment, context);
    },
  } satisfies ExportedHandler<ProductionEnvironment>;
}

export default createProductionWorker();
