import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("current delivery-attempt schema", () => {
  it("contains no retired provider-attachment state or validation objects", async () => {
    const columns = await env.TEST_DB.prepare(
      "PRAGMA table_info(delivery_attempts)",
    ).all<{ name: string }>();
    expect(columns.results.map((column) => column.name)).not.toEqual(
      expect.arrayContaining(["provider_ticket_envelope", "provider_capability_hash"]),
    );

    const objects = await env.TEST_DB.prepare(`
      SELECT name FROM sqlite_master
      WHERE name IN (
        'delivery_attempts_provider_capability_hash',
        'validate_provider_capability_hash_insert',
        'validate_provider_capability_hash_update',
        'validate_provider_ticket_envelope_insert',
        'validate_provider_ticket_envelope_update'
      )
    `).all<{ name: string }>();
    expect(objects.results).toEqual([]);
  });
});
