import { bytesToHex, sha256Bytes } from "../document/hash";
import { validatePdfUpload } from "../document/pdf-contract";
import { parseFinalizationMetadata } from "../http/finalization-metadata";
import { MAXIMUM_FINALIZATION_REQUEST_BYTES } from "../http/finalize-release-route";

interface MultipartSpikeEnvironment {
  SPIKE_TRIGGER_TOKEN?: string;
}

function authorized(request: Request, expectedToken: string | undefined): boolean {
  if (!expectedToken) return false;
  const supplied = request.headers.get("authorization");
  if (!supplied?.startsWith("Bearer ")) return false;

  const actual = new TextEncoder().encode(supplied.slice("Bearer ".length));
  const expected = new TextEncoder().encode(expectedToken);
  if (actual.length !== expected.length) return false;

  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= actual[index] ^ expected[index];
  }
  return difference === 0;
}

export async function handleMultipartFinalizationSpike(
  request: Request,
  environment: MultipartSpikeEnvironment,
): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/spike/multipart-finalization") {
      return new Response("Not found", { status: 404 });
    }
    if (!authorized(request, environment.SPIKE_TRIGGER_TOKEN)) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
      return Response.json({ error: "INVALID_REQUEST" }, { status: 415 });
    }
    const declaredLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAXIMUM_FINALIZATION_REQUEST_BYTES) {
      return Response.json({ error: "PDF_TOO_LARGE" }, { status: 413 });
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
    }
    if (
      [...form.keys()].some((key) => key !== "document" && key !== "metadata")
      || form.getAll("document").length !== 1
      || form.getAll("metadata").length !== 1
    ) {
      return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
    }

    const document = form.get("document");
    const serializedMetadata = form.get("metadata");
    if (!(document instanceof File) || typeof serializedMetadata !== "string") {
      return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
    }
    const metadata = parseFinalizationMetadata(serializedMetadata);
    if (!metadata.valid) return Response.json({ error: metadata.reason }, { status: 400 });

    const bytes = new Uint8Array(await document.arrayBuffer());
    const upload = validatePdfUpload(bytes);
    if (!upload.valid) return Response.json({ error: upload.reason }, { status: 400 });
    const sha256 = bytesToHex(await sha256Bytes(bytes));
    if (sha256 !== metadata.metadata.browserDocumentHash) {
      return Response.json({ error: "HASH_MISMATCH" }, { status: 400 });
    }

    return Response.json({
      byteLength: bytes.byteLength,
      metadataAccepted: true,
      sha256,
    });
}

export default {
  fetch: handleMultipartFinalizationSpike,
} satisfies ExportedHandler<MultipartSpikeEnvironment>;
