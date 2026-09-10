import { createSealProofWorker, type SealProofEnvironment } from "./app";
import { FakeDeliveryProvider } from "../delivery/fake-delivery-provider";
import { submitPendingDeliveries } from "../delivery/submit-pending-deliveries";
import type { SealedReleaseHandler } from "../http/ticket-finalization-route";
import type { RetryDeliveryHandler } from "../http/retry-delivery-route";
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

async function submitLocalFakeDelivery(
  transactionId: string,
  submittedAt: number,
  environment: SealProofEnvironment,
): Promise<void> {
  const localEnvironment = environment as SealProofEnvironment;
  const piiKey = decodeKey(localEnvironment.KEY_ENCRYPTION_KEY_BASE64);
  if (!piiKey) {
    throw new Error("Local fake delivery keys are invalid");
  }
  try {
    const provider = new FakeDeliveryProvider();
    await submitPendingDeliveries(
      localEnvironment.RELEASE_DB,
      transactionId,
      {
        provider,
        documents: localEnvironment.RELEASE_DOCUMENTS,
        keyEncryptionKeys: { [localEnvironment.ACTIVE_KEY_VERSION]: piiKey },
      },
      submittedAt,
    );
  } finally {
    piiKey.fill(0);
  }
}

export const runLocalFakeDelivery: SealedReleaseHandler = async (
  notification,
  environment,
) => submitLocalFakeDelivery(
  notification.transactionId,
  notification.sealedAt,
  environment as SealProofEnvironment,
);

export const runLocalFakeRetry: RetryDeliveryHandler = async (
  notification,
  environment,
) => submitLocalFakeDelivery(
  notification.transactionId,
  notification.requestedAt,
  environment as SealProofEnvironment,
);

const localWorker = createSealProofWorker({
  fetcher: async () => Response.json({
    success: true,
    hostname: "localhost",
    action: "release-finalization",
  }),
  afterSealed: runLocalFakeDelivery,
  retryDelivery: runLocalFakeRetry,
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
