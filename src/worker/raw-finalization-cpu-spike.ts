import { issueFinalizationTicket, openFinalizationTicket } from "../admission/finalization-ticket";
import { encryptTemporaryPdf } from "../crypto/temporary-pdf";
import { sha256Hex } from "../document/hash";
import { validatePdfUpload } from "../document/pdf-contract";

interface SpikeEnvironment {
  SPIKE_TRIGGER_TOKEN?: string;
}

const TICKET_KEY = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);
const PDF_KEY = Uint8Array.from({ length: 32 }, (_, index) => index);
const TICKET_KEY_VERSION = "synthetic-ticket-v1";
const PDF_KEY_VERSION = "synthetic-pdf-v1";

function authorized(request: Request, expected: string | undefined): boolean {
  const supplied = request.headers.get("x-spike-trigger");
  if (!expected || !supplied) return false;
  const actualBytes = new TextEncoder().encode(supplied);
  const expectedBytes = new TextEncoder().encode(expected);
  if (actualBytes.length !== expectedBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < actualBytes.length; index += 1) {
    difference |= actualBytes[index] ^ expectedBytes[index];
  }
  return difference === 0;
}

function finalizationTicket(request: Request): string | undefined {
  const value = request.headers.get("authorization");
  return value?.startsWith("SealProofTicket ") ? value.slice("SealProofTicket ".length) : undefined;
}

async function issueSyntheticTicket(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }
  const hash = typeof body === "object" && body !== null
    ? (body as Record<string, unknown>).documentHash
    : undefined;
  if (typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) {
    return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }
  const issued = await issueFinalizationTicket({
    productionEmail: "producer@example.invalid",
    signerEmail: "signer@example.invalid",
    documentHash: hash,
  }, "synthetic-workflow-v1", TICKET_KEY_VERSION, TICKET_KEY, Date.now());
  return Response.json(issued, { headers: { "cache-control": "no-store" } });
}

async function measureRawFinalization(request: Request): Promise<Response> {
  const ticket = finalizationTicket(request);
  if (!ticket) return Response.json({ error: "INVALID_TICKET" }, { status: 401 });
  const opened = await openFinalizationTicket(ticket, { [TICKET_KEY_VERSION]: TICKET_KEY }, Date.now());
  if (!opened.valid) return Response.json({ error: "INVALID_TICKET" }, { status: 401 });

  const bytes = new Uint8Array(await request.arrayBuffer());
  const contract = validatePdfUpload(bytes);
  if (!contract.valid) return Response.json({ error: contract.reason }, { status: 400 });
  const documentHash = await sha256Hex(bytes);
  if (documentHash !== opened.payload.documentHash) {
    return Response.json({ error: "HASH_MISMATCH" }, { status: 400 });
  }
  const transactionId = crypto.randomUUID();
  const encrypted = await encryptTemporaryPdf(
    bytes, transactionId, documentHash, PDF_KEY_VERSION, PDF_KEY,
  );
  const ciphertextHash = await sha256Hex(encrypted.ciphertext);
  return Response.json({
    byteLength: bytes.byteLength,
    ciphertextBytes: encrypted.ciphertext.byteLength,
    documentHash,
    ciphertextHash,
  });
}

export default {
  async fetch(request, environment): Promise<Response> {
    if (!authorized(request, environment.SPIKE_TRIGGER_TOKEN)) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const path = new URL(request.url).pathname;
    if (request.method === "POST" && path === "/spike/raw-finalization/ticket") {
      return issueSyntheticTicket(request);
    }
    if (request.method === "POST" && path === "/spike/raw-finalization") {
      return measureRawFinalization(request);
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<SpikeEnvironment>;
