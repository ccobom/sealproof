const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const MAXIMUM_TOKEN_LENGTH = 2_048;

export interface TurnstileConfiguration {
  secretKey: string;
  expectedHostname: string;
  expectedAction: string;
}

export type TurnstileVerificationResult =
  | { verified: true }
  | { verified: false; reason: "REJECTED" | "SERVICE_UNAVAILABLE" };

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function validConfiguration(value: string, maximum: number): boolean {
  return value.length >= 1 && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value);
}

export async function verifyTurnstileToken(
  token: string,
  configuration: TurnstileConfiguration,
  fetcher: Fetcher = fetch,
): Promise<TurnstileVerificationResult> {
  if (
    typeof token !== "string"
    || token.length < 1
    || token.length > MAXIMUM_TOKEN_LENGTH
  ) return { verified: false, reason: "REJECTED" };
  if (
    !validConfiguration(configuration.secretKey, 512)
    || !validConfiguration(configuration.expectedHostname, 253)
    || !validConfiguration(configuration.expectedAction, 64)
  ) return { verified: false, reason: "SERVICE_UNAVAILABLE" };

  let response: Response;
  try {
    response = await fetcher(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: configuration.secretKey,
        response: token,
        idempotency_key: crypto.randomUUID(),
      }),
    });
  } catch {
    return { verified: false, reason: "SERVICE_UNAVAILABLE" };
  }
  if (!response.ok) return { verified: false, reason: "SERVICE_UNAVAILABLE" };

  let value: unknown;
  try {
    value = await response.json();
  } catch {
    return { verified: false, reason: "SERVICE_UNAVAILABLE" };
  }
  if (typeof value !== "object" || value === null) {
    return { verified: false, reason: "SERVICE_UNAVAILABLE" };
  }
  const result = value as Record<string, unknown>;
  if (result.success !== true) return { verified: false, reason: "REJECTED" };
  if (
    result.hostname !== configuration.expectedHostname
    || result.action !== configuration.expectedAction
  ) return { verified: false, reason: "REJECTED" };
  return { verified: true };
}
