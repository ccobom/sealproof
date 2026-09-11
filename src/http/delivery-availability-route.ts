import { deliveryAvailable } from "../delivery/delivery-budget";

export async function handleDeliveryAvailabilityRequest(
  request: Request,
  environment: { EXPECTED_HOSTNAME: string; DELIVERY_ENABLED?: string; RELEASE_DB: D1Database },
  now: number,
): Promise<Response> {
  const headers = {
    "cache-control": "private, no-store, max-age=0",
    "x-content-type-options": "nosniff",
  };
  const url = new URL(request.url);
  if (url.protocol !== "https:" || url.hostname !== environment.EXPECTED_HOSTNAME) {
    return new Response(null, { status: 404, headers });
  }
  if (request.method !== "GET") {
    return new Response(null, { status: 405, headers: { ...headers, allow: "GET" } });
  }
  const available = await deliveryAvailable(environment, now);
  return Response.json(
    available ? { available: true } : { error: "DELIVERY_UNAVAILABLE" },
    { status: available ? 200 : 503, headers },
  );
}
