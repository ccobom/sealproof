import { createSealProofWorker } from "./app";
import { createProductionDeliveryHandlers } from "./production-delivery";

type NetworkFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function createProductionWorker(fetcher?: NetworkFetcher) {
  const delivery = createProductionDeliveryHandlers(fetcher);
  return createSealProofWorker({
    fetcher,
    afterSealed: delivery.afterSealed,
    retryDelivery: delivery.retryDelivery,
  });
}

export default createProductionWorker();
