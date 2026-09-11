import { decryptTemporaryPdf, encryptTemporaryPdf } from "../crypto/temporary-pdf";
import { bytesToBase64 } from "../document/base64";
import { sha256Hex } from "../document/hash";
import { FINAL_PDF_CONTRACT, validatePdfUpload } from "../document/pdf-contract";

interface DirectAttachmentSpikeEnvironment {
  SPIKE_TRIGGER_TOKEN?: string;
}

const SYNTHETIC_PDF_KEY = Uint8Array.from({ length: 32 }, (_, index) => index);
const SYNTHETIC_KEY_VERSION = "synthetic-direct-attachment-v1";
const NO_STORE_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
} as const;

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

function resendShapedBody(content: string, hash: string, role: "production" | "signer"): string {
  return JSON.stringify({
    from: "SealProof Synthetic <releases@example.invalid>",
    to: [`${role}@example.invalid`],
    subject: "SealProof synthetic CPU measurement",
    text: `Synthetic test only. Document SHA-256: ${hash}`,
    attachments: [{
      content,
      filename: "sealproof-release.pdf",
    }],
  });
}

export async function measureDirectAttachmentPreparation(request: Request): Promise<Response> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase()
    !== "application/pdf") {
    return Response.json({ error: "INVALID_CONTENT_TYPE" }, {
      status: 415,
      headers: NO_STORE_HEADERS,
    });
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > FINAL_PDF_CONTRACT.maximumBytes) {
    return Response.json({ error: "PDF_TOO_LARGE" }, { status: 413, headers: NO_STORE_HEADERS });
  }

  const pdfBytes = new Uint8Array(await request.arrayBuffer());
  const contract = validatePdfUpload(pdfBytes);
  if (!contract.valid) {
    pdfBytes.fill(0);
    return Response.json({ error: contract.reason }, {
      status: contract.reason === "PDF_TOO_LARGE" ? 413 : 400,
      headers: NO_STORE_HEADERS,
    });
  }

  const transactionId = crypto.randomUUID();
  let ciphertext: Uint8Array | undefined;
  let decrypted: Uint8Array | undefined;
  try {
    const documentHash = await sha256Hex(pdfBytes);
    const encrypted = await encryptTemporaryPdf(
      pdfBytes,
      transactionId,
      documentHash,
      SYNTHETIC_KEY_VERSION,
      SYNTHETIC_PDF_KEY,
    );
    ciphertext = encrypted.ciphertext;
    const ciphertextHash = await sha256Hex(ciphertext);
    decrypted = await decryptTemporaryPdf(
      ciphertext,
      encrypted.metadata,
      transactionId,
      documentHash,
      { [SYNTHETIC_KEY_VERSION]: SYNTHETIC_PDF_KEY },
    );

    // The optimized coordinator verifies and encodes once, then reuses the
    // exact immutable Base64 content in both role-specific Resend requests.
    if (await sha256Hex(decrypted) !== documentHash) throw new Error("DELIVERY_HASH_MISMATCH");
    const attachmentContent = bytesToBase64(decrypted);
    const productionBody = resendShapedBody(attachmentContent, documentHash, "production");
    const signerBody = resendShapedBody(attachmentContent, documentHash, "signer");

    return Response.json({
      byteLength: pdfBytes.byteLength,
      ciphertextBytes: ciphertext.byteLength,
      documentHash,
      ciphertextHash,
      base64Length: attachmentContent.length,
      productionRequestBytes: new TextEncoder().encode(productionBody).byteLength,
      signerRequestBytes: new TextEncoder().encode(signerBody).byteLength,
      roleContentsMatch: true,
      storage: "none",
      email: "none",
    }, { headers: NO_STORE_HEADERS });
  } finally {
    pdfBytes.fill(0);
    decrypted?.fill(0);
    ciphertext?.fill(0);
  }
}

export default {
  async fetch(request, environment): Promise<Response> {
    if (!authorized(request, environment.SPIKE_TRIGGER_TOKEN)) {
      return Response.json({ error: "NOT_FOUND" }, { status: 404, headers: NO_STORE_HEADERS });
    }
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/spike/direct-attachment") {
      return Response.json({ error: "NOT_FOUND" }, { status: 404, headers: NO_STORE_HEADERS });
    }
    return measureDirectAttachmentPreparation(request);
  },
} satisfies ExportedHandler<DirectAttachmentSpikeEnvironment>;
