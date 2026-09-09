import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";

const endpoint = process.env.SPIKE_ENDPOINT;
const trigger = process.env.SPIKE_TRIGGER_TOKEN;
if (!endpoint || !trigger) throw new Error("SPIKE_ENDPOINT and SPIKE_TRIGGER_TOKEN are required");

function positiveInteger(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

const byteLength = positiveInteger("SPIKE_BYTES", 3_000_000);
const requestCount = positiveInteger("SPIKE_REQUESTS", 1);

const source = new Uint8Array(await readFile(".wrangler/vector-signature-spike.pdf"));
if (byteLength < source.byteLength) {
  throw new Error(`SPIKE_BYTES must be at least the ${source.byteLength}-byte fixture size`);
}
const bytes = new Uint8Array(byteLength);
bytes.set(source);
const digest = new Uint8Array(await webcrypto.subtle.digest("SHA-256", bytes));
const documentHash = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");

async function issueTicket() {
  for (let attempt = 1; attempt <= 15; attempt += 1) {
    const response = await fetch(`${endpoint}/ticket`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-spike-trigger": trigger },
      body: JSON.stringify({ documentHash }),
    });
    if (response.ok) return response.json();
    const body = await response.text();
    if (response.status !== 401 || attempt === 15) {
      throw new Error(`Ticket issuance failed: ${body}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

async function invoke(ticket) {
  for (let attempt = 1; attempt <= 15; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/pdf",
          authorization: `SealProofTicket ${ticket}`,
          "x-spike-trigger": trigger,
        },
        body: bytes,
      });
      if (response.status !== 401 || attempt === 15) return response;
      await response.arrayBuffer();
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    } catch (error) {
      if (attempt === 15) throw error;
    }
  }
}

const statuses = [];
const durations = [];
const { ticket } = await issueTicket();
for (let index = 0; index < requestCount; index += 1) {
  const startedAt = performance.now();
  const response = await invoke(ticket);
  durations.push(Math.round(performance.now() - startedAt));
  statuses.push(response.status);
  if (!response.ok) throw new Error(`Spike rejected request: ${await response.text()}`);
}
const grouped = Object.groupBy(statuses, (status) => String(status));
const counts = Object.fromEntries(Object.entries(grouped).map(([status, values]) => [status, values?.length ?? 0]));
process.stdout.write(`Requests: ${JSON.stringify(counts)}\n`);
process.stdout.write(`Bytes per request: ${byteLength}\n`);
process.stdout.write(`Round-trip milliseconds: ${durations.join(", ")}\n`);
