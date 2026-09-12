// Read-only/denied-request smoke checks for the isolated test environment.
// No valid admission, PDF, recipient address, secret or release capability is used.
import assert from "node:assert/strict";
const origin = "https://test.sealproof.app";
const fakeRelease = "00000000-0000-4000-8000-000000000000";
const bearer = `Bearer ${"x".repeat(43)}`;
const cases = [
  ["assets", "/", "GET", 200],
  ["public configuration", "/api/public-config", "GET", 200],
  ["availability disabled", "/api/delivery-availability", "GET", 503, "DELIVERY_UNAVAILABLE"],
  ["admission disabled", "/api/releases/admissions", "POST", 503, "DELIVERY_UNAVAILABLE"],
  ["finalization disabled", "/api/releases/finalize", "POST", 503, "DELIVERY_UNAVAILABLE"],
  ["retry disabled", `/api/releases/${fakeRelease}/retry`, "POST", 503, "DELIVERY_UNAVAILABLE"],
  ["recovery disabled", `/api/releases/${fakeRelease}/recover`, "POST", 503, "DELIVERY_UNAVAILABLE"],
  ["status authorization active", `/api/releases/${fakeRelease}/status`, "GET", 404, "NOT_FOUND"],
  ["closeout authorization active", `/api/releases/${fakeRelease}`, "DELETE", 404, "NOT_FOUND"],
  ["webhook signature verification active", "/api/webhooks/resend", "POST", 401, "INVALID_SIGNATURE"],
];
for (const [label, path, method, expectedStatus, expectedError] of cases) {
  const webhook = path === "/api/webhooks/resend";
  const response = await fetch(origin + path, {
    method, redirect: "error", signal: AbortSignal.timeout(15_000),
    headers: { origin, authorization: bearer, ...(webhook ? { "content-type": "application/json" } : {}) },
    ...(webhook ? { body: "{}" } : {}),
  });
  assert.equal(response.status, expectedStatus, `${label}: unexpected HTTP status`);
  if (expectedError) {
    assert.equal((await response.json()).error, expectedError, `${label}: unexpected error code`);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/, `${label}: missing no-store`);
  } else {
    await response.arrayBuffer();
  }
  console.log(`PASS ${label}: HTTP ${response.status}`);
}
console.log("Disabled deployment smoke checks passed. No successful release operation or email submission requested.");
