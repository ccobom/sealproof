import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";

const endpoint = process.env.SPIKE_ENDPOINT;
const token = process.env.SPIKE_TRIGGER_TOKEN;
if (!endpoint || !token) throw new Error("SPIKE_ENDPOINT and SPIKE_TRIGGER_TOKEN are required");

const source = new Uint8Array(await readFile(".wrangler/vector-signature-spike.pdf"));
const bytes = new Uint8Array(2_013_402);
bytes.set(source);
const digest = new Uint8Array(await webcrypto.subtle.digest("SHA-256", bytes));
const hash = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
const metadata = JSON.stringify({
  productionEmail: "producer@example.invalid",
  signerEmail: "signer@example.invalid",
  browserDocumentHash: hash,
});

async function invoke() {
  const form = new FormData();
  form.set("document", new Blob([bytes], { type: "application/pdf" }), "synthetic.pdf");
  form.set("metadata", metadata);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await fetch(endpoint, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: form,
      });
    } catch (error) {
      if (attempt === 3) throw error;
    }
  }
  throw new Error("Unreachable retry state");
}

const statuses = [];
for (let index = 0; index < 25; index += 1) {
  const response = await invoke();
  statuses.push(response.status);
  if (!response.ok) throw new Error(`Spike rejected request: ${await response.text()}`);
}

const grouped = Object.groupBy(statuses, (status) => String(status));
const counts = Object.fromEntries(
  Object.entries(grouped).map(([status, values]) => [status, values?.length ?? 0]),
);
process.stdout.write(`Requests: ${JSON.stringify(counts)}\n`);
