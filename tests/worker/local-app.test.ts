import { describe, expect, it } from "vitest";
import { isLocalRequest } from "../../src/worker/local-app";

describe("local-only application entry point", () => {
  it("accepts only loopback hostnames", () => {
    expect(isLocalRequest(new Request("https://localhost:8787/"))).toBe(true);
    expect(isLocalRequest(new Request("https://127.0.0.1:8787/"))).toBe(true);
    expect(isLocalRequest(new Request("https://sealproof.example/"))).toBe(false);
    expect(isLocalRequest(new Request("https://sealproof-local-only.example.workers.dev/"))).toBe(false);
  });
});
