import { z } from "zod";

const publicConfigSchema = z.strictObject({
  turnstileSiteKey: z.string().regex(/^0x[A-Za-z0-9_-]{20,128}$/),
  turnstileAction: z.literal("release-finalization"),
});

export type PublicConfig = z.infer<typeof publicConfigSchema>;
type PublicConfigRequestInit = RequestInit & { credentials: "omit" };
export type PublicConfigFetcher = (
  input: RequestInfo | URL,
  init?: PublicConfigRequestInit,
) => Promise<Response>;

export async function loadPublicConfig(
  fetcher: PublicConfigFetcher = fetch as PublicConfigFetcher,
): Promise<PublicConfig> {
  const response = await fetcher("/api/public-config", {
    method: "GET",
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
  });
  if (!response.ok) throw new Error("Public configuration is unavailable");
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("Public configuration is invalid");
  }
  const parsed = publicConfigSchema.safeParse(body);
  if (!parsed.success) throw new Error("Public configuration is invalid");
  return parsed.data;
}
