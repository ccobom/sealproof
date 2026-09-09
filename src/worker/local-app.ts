import { createSealProofWorker, type SealProofEnvironment } from "./app";
import { FakeDeliveryProvider } from "../delivery/fake-delivery-provider";
import { submitPendingDeliveries } from "../delivery/submit-pending-deliveries";
import { handleProviderAttachmentRequest } from "../http/provider-attachment-route";
import type { SealedReleaseHandler } from "../http/ticket-finalization-route";
import {
  handleLocalFakeWebhookRequest,
  type LocalFakeWebhookEnvironment,
} from "../http/local-fake-webhook-route";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

function decodeKey(value: string): Uint8Array | undefined {
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
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(version) || typeof encoded !== "string") return undefined;
      const key = decodeKey(encoded);
      if (!key) return undefined;
      keys[version] = key;
    }
    return keys;
  } catch {
    return undefined;
  }
}

export const runLocalFakeDelivery: SealedReleaseHandler = async (
  notification,
  environment,
) => {
  const localEnvironment = environment as SealProofEnvironment;
  const piiKey = decodeKey(localEnvironment.KEY_ENCRYPTION_KEY_BASE64);
  const attachmentKeys = providerKeys(localEnvironment.PROVIDER_ATTACHMENT_KEYS_JSON);
  const activeAttachmentKey = attachmentKeys?.[
    localEnvironment.ACTIVE_PROVIDER_ATTACHMENT_KEY_VERSION
  ];
  if (!piiKey || !attachmentKeys || !activeAttachmentKey) {
    piiKey?.fill(0);
    if (attachmentKeys) for (const key of Object.values(attachmentKeys)) key.fill(0);
    throw new Error("Local fake delivery keys are invalid");
  }
  try {
    const provider = new FakeDeliveryProvider((request) =>
      handleProviderAttachmentRequest(request, localEnvironment, notification.sealedAt));
    await submitPendingDeliveries(
      localEnvironment.RELEASE_DB,
      notification.transactionId,
      {
        provider,
        keyEncryptionKeys: { [localEnvironment.ACTIVE_KEY_VERSION]: piiKey },
        providerAttachmentKeyVersion: localEnvironment.ACTIVE_PROVIDER_ATTACHMENT_KEY_VERSION,
        providerAttachmentKeys: attachmentKeys,
        publicOrigin: notification.publicOrigin,
      },
      notification.sealedAt,
    );
  } finally {
    piiKey.fill(0);
    for (const key of Object.values(attachmentKeys)) key.fill(0);
  }
};

const localWorker = createSealProofWorker({
  fetcher: async () => Response.json({
    success: true,
    hostname: "localhost",
    action: "release-finalization",
  }),
  afterSealed: runLocalFakeDelivery,
});

export function isLocalRequest(request: Request): boolean {
  return LOCAL_HOSTNAMES.has(new URL(request.url).hostname);
}

export default {
  async fetch(
    request: Request,
    environment: SealProofEnvironment & LocalFakeWebhookEnvironment,
  ): Promise<Response> {
    if (!isLocalRequest(request)) {
      return Response.json({ error: "LOCAL_BUILD_ONLY" }, {
        status: 503,
        headers: { "cache-control": "private, no-store, max-age=0" },
      });
    }
    if (/^\/api\/local\/releases\/[A-Za-z0-9_-]{16,128}\/fake-webhook$/.test(
      new URL(request.url).pathname,
    )) {
      return handleLocalFakeWebhookRequest(request, environment);
    }
    return localWorker.fetch(request, environment);
  },
  scheduled(
    controller: ScheduledController,
    environment: SealProofEnvironment,
    context: ExecutionContext,
  ): void {
    localWorker.scheduled(controller, environment, context);
  },
} satisfies ExportedHandler<SealProofEnvironment & LocalFakeWebhookEnvironment>;
