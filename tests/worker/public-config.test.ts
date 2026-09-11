import { describe, expect, it, vi } from "vitest";
import {
  loadPublicConfig,
  type PublicConfigFetcher,
} from "../../src/app/public-config-client";
import { handlePublicConfigRequest } from "../../src/http/public-config-route";

const ENVIRONMENT = {
  DELIVERY_ENABLED: "true",
  EXPECTED_HOSTNAME: "test.sealproof.app",
  TURNSTILE_SITE_KEY: "0x4AAAAAAEugZnhz6_XrWjKi",
};

describe("public browser configuration", () => {
  it("returns only the public Turnstile values from the exact host", async () => {
    const response = handlePublicConfigRequest(
      new Request("https://test.sealproof.app/api/public-config"), ENVIRONMENT,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      turnstileSiteKey: ENVIRONMENT.TURNSTILE_SITE_KEY,
      turnstileAction: "release-finalization",
    });
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
  });

  it("rejects wrong hosts, query strings, and unsupported methods", () => {
    expect(handlePublicConfigRequest(
      new Request("https://evil.example/api/public-config"), ENVIRONMENT,
    ).status).toBe(404);
    expect(handlePublicConfigRequest(
      new Request("https://test.sealproof.app/api/public-config?extra=true"), ENVIRONMENT,
    ).status).toBe(404);
    expect(handlePublicConfigRequest(new Request(
      "https://test.sealproof.app/api/public-config", { method: "POST" },
    ), ENVIRONMENT).status).toBe(405);
  });

  it("loads strict configuration without browser credentials", async () => {
    const fetcher = vi.fn<PublicConfigFetcher>().mockResolvedValue(Response.json({
      turnstileSiteKey: ENVIRONMENT.TURNSTILE_SITE_KEY,
      turnstileAction: "release-finalization",
    }));
    await expect(loadPublicConfig(fetcher)).resolves.toEqual({
      turnstileSiteKey: ENVIRONMENT.TURNSTILE_SITE_KEY,
      turnstileAction: "release-finalization",
    });
    expect(fetcher).toHaveBeenCalledWith("/api/public-config", {
      method: "GET", cache: "no-store", credentials: "omit", redirect: "error",
    });
  });

  it("rejects extra, malformed, and failed configuration responses", async () => {
    await expect(loadPublicConfig(async () => Response.json({
      turnstileSiteKey: ENVIRONMENT.TURNSTILE_SITE_KEY,
      turnstileAction: "release-finalization",
      secret: "must-not-be-accepted",
    }))).rejects.toThrow("Public configuration is invalid");
    await expect(loadPublicConfig(async () => new Response("unavailable", { status: 503 })))
      .rejects.toThrow("Public configuration is unavailable");
  });
});
