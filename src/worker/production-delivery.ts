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

function providerKeys(value: string): Record<string, Uint8Array> | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
    const entries = Object.entries(parsed);
    if (entries.length < 1 || entries.length > 4) return undefined;
    const keys: Record<string, Uint8Array> = {};
    for (const [version, encoded] of entries) {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(version) || typeof encoded !== "string") {
        return undefined;
      }
      const key = decodeKey(encoded);
      if (!key) return undefined;
      keys[version] = key;
    }
    return keys;
  } catch {
    return undefined;
  }
}

async function submitProductionDelivery(
  transactionId: string,
  publicOrigin: string,
  submittedAt: number,
  environment: ProductionDeliveryEnvironment,
  fetcher?: NetworkFetcher,
): Promise<void> {
  const piiKey = decodeKey(environment.KEY_ENCRYPTION_KEY_BASE64);
  const attachmentKeys = providerKeys(environment.PROVIDER_ATTACHMENT_KEYS_JSON);
  const activeAttachmentKey = attachmentKeys?.[
    environment.ACTIVE_PROVIDER_ATTACHMENT_KEY_VERSION
  ];
  if (!piiKey || !attachmentKeys || !activeAttachmentKey) {
    piiKey?.fill(0);
    if (attachmentKeys) for (const key of Object.values(attachmentKeys)) key.fill(0);
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
        keyEncryptionKeys: { [environment.ACTIVE_KEY_VERSION]: piiKey },
        providerAttachmentKeyVersion: environment.ACTIVE_PROVIDER_ATTACHMENT_KEY_VERSION,
        providerAttachmentKeys: attachmentKeys,
        publicOrigin,
      },
      submittedAt,
    );
    if (result.failed.length > 0) throw new Error("Production delivery submission failed");
  } finally {
    piiKey.fill(0);
    for (const key of Object.values(attachmentKeys)) key.fill(0);
  }
}

export function createProductionDeliveryHandlers(fetcher?: NetworkFetcher): {
  afterSealed: SealedReleaseHandler;
  retryDelivery: RetryDeliveryHandler;
} {
  return {
    afterSealed: (notification, environment) => submitProductionDelivery(
      notification.transactionId,
      notification.publicOrigin,
      notification.sealedAt,
      environment as ProductionDeliveryEnvironment,
      fetcher,
    ),
    retryDelivery: (notification, environment) => submitProductionDelivery(
      notification.transactionId,
      notification.publicOrigin,
      notification.requestedAt,
      environment as ProductionDeliveryEnvironment,
      fetcher,
    ),
  };
}
