const NO_STORE_HEADERS = {
  "cache-control": "public, max-age=300",
  "x-content-type-options": "nosniff",
} as const;

export interface PublicConfigEnvironment {
  EXPECTED_HOSTNAME: string;
  TURNSTILE_SITE_KEY: string;
}

export function handlePublicConfigRequest(
  request: Request,
  environment: PublicConfigEnvironment,
): Response {
  if (request.method !== "GET") {
    return new Response(null, {
      status: 405,
      headers: { ...NO_STORE_HEADERS, allow: "GET" },
    });
  }
  const url = new URL(request.url);
  if (
    url.protocol !== "https:"
    || url.hostname !== environment.EXPECTED_HOSTNAME
    || url.pathname !== "/api/public-config"
    || url.search !== ""
  ) return Response.json({ error: "NOT_FOUND" }, { status: 404, headers: NO_STORE_HEADERS });

  return Response.json({
    turnstileSiteKey: environment.TURNSTILE_SITE_KEY,
    turnstileAction: "release-finalization",
  }, { headers: NO_STORE_HEADERS });
}
