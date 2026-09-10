const MAXIMUM_BYTES = 3_000_000;
const endpoint = process.argv[2];
const requestedSize = Number(process.argv[3]);
const repetitions = process.argv[4] === undefined ? 1 : Number(process.argv[4]);
const trigger = process.env.SPIKE_TRIGGER_TOKEN;

if (!endpoint) {
  throw new Error("Usage: node scripts/run-direct-attachment-cpu-spike.mjs <worker-origin> <bytes> [repetitions]");
}
const origin = new URL(endpoint);
if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash) {
  throw new Error("Worker origin must be an HTTPS origin ending in /");
}
if (!Number.isSafeInteger(requestedSize) || requestedSize < 48 || requestedSize > MAXIMUM_BYTES) {
  throw new Error(`bytes must be an integer from 48 through ${MAXIMUM_BYTES}`);
}
if (!Number.isSafeInteger(repetitions) || repetitions < 1 || repetitions > 25) {
  throw new Error("repetitions must be an integer from 1 through 25");
}
if (!trigger || trigger.length < 16 || trigger.length > 512) {
  throw new Error("Set SPIKE_TRIGGER_TOKEN to the temporary Worker secret before running");
}

const bytes = new Uint8Array(requestedSize);
bytes.set(new TextEncoder().encode("%PDF-1.7\n% SealProof synthetic remote CPU fixture\n"));
for (let index = 48; index < bytes.length; index += 4_096) bytes[index] = index % 251;

for (let attempt = 1; attempt <= repetitions; attempt += 1) {
  const started = performance.now();
  const response = await fetch(new URL("/spike/direct-attachment", origin), {
    method: "POST",
    headers: {
      "content-type": "application/pdf",
      "x-spike-trigger": trigger,
    },
    body: bytes,
  });
  const elapsedMilliseconds = Math.round(performance.now() - started);
  const responseText = await response.text();
  let result;
  try {
    result = JSON.parse(responseText);
  } catch {
    result = { error: "NON_JSON_RESPONSE" };
  }
  console.log(JSON.stringify({
    attempt,
    requestedSize,
    status: response.status,
    elapsedMilliseconds,
    result,
  }));
  if (!response.ok) process.exitCode = 1;
}

bytes.fill(0);
