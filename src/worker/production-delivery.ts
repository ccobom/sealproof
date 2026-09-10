import { ResendDeliveryProvider } from "../delivery/resend-delivery-provider";
import { submitPendingDeliveries } from "../delivery/submit-pending-deliveries";
import type { SealedReleaseHandler } from "../http/ticket-finalization-route";
import type { RetryDeliveryHandler } from "../http/retry-delivery-route";
import type { SealProofEnvironment } from "./app";

type NetworkFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface ProductionDeliveryEnvironment extends SealProofEnvironment {
  RESEND_API_KEY: string;
  RESEND_FROM: string;
}

function decodeKey(value: string): Uint8Array | undefined {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return undefined;
  }
  try {
    const binary = atob(value);
    return binary.length === 32
      ? Uint8Array.from(binary, (character) => character.charCodeAt(0))
      : undefined;
  } catch {
    return undefined;
  }
}

async function submitProductionDelivery(
  transactionId: string,
  submittedAt: number,
  environment: ProductionDeliveryEnvironment,
  fetcher?: NetworkFetcher,
): Promise<void> {
  const piiKey = decodeKey(environment.KEY_ENCRYPTION_KEY_BASE64);
  if (!piiKey) {
    throw new Error("Production delivery configuration is invalid");
  }

  try {
    const provider = new ResendDeliveryProvider({
      apiKey: environment.RESEND_API_KEY,
      from: environment.RESEND_FROM,
      fetcher,
    });
    const result = await submitPendingDeliveries(
      environment.RELEASE_DB,
      transactionId,
      {
        provider,
        documents: environment.RELEASE_DOCUMENTS,
        keyEncryptionKeys: { [environment.ACTIVE_KEY_VERSION]: piiKey },
      },
      submittedAt,
    );
    if (result.failed.length > 0) throw new Error("Production delivery submission failed");
  } finally {
    piiKey.fill(0);
  }
}

export function createProductionDeliveryHandlers(fetcher?: NetworkFetcher): {
  afterSealed: SealedReleaseHandler;
  retryDelivery: RetryDeliveryHandler;
} {
  return {
    afterSealed: (notification, environment) => submitProductionDelivery(
      notification.transactionId,
      notification.sealedAt,
      environment as ProductionDeliveryEnvironment,
      fetcher,
    ),
    retryDelivery: (notification, environment) => submitProductionDelivery(
      notification.transactionId,
      notification.requestedAt,
      environment as ProductionDeliveryEnvironment,
      fetcher,
    ),
  };
}
