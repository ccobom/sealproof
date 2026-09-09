import { FINAL_PDF_CONTRACT, validateFinalPdf } from "../document/pdf-contract";
import { sha256Hex } from "../document/hash";

interface PdfValidationSpikeEnvironment {
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

export default {
  async fetch(request, environment): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/spike/pdf-contract") {
      return new Response("Not found", { status: 404 });
    }
    if (!authorized(request, environment.SPIKE_TRIGGER_TOKEN)) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (request.headers.get("content-type") !== "application/pdf") {
      return Response.json({ error: "Expected application/pdf" }, { status: 415 });
    }

    const declaredLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > FINAL_PDF_CONTRACT.maximumBytes) {
      return Response.json({ error: "PDF_TOO_LARGE" }, { status: 413 });
    }

    const bytes = new Uint8Array(await request.arrayBuffer());
    const validation = await validateFinalPdf(bytes);
    if (!validation.valid) {
      const status = validation.reason === "PDF_TOO_LARGE" ? 413 : 400;
      return Response.json({ error: validation.reason }, { status });
    }

    return Response.json({
      byteLength: bytes.byteLength,
      pageCount: validation.pageCount,
      sha256: await sha256Hex(bytes),
    });
  },
} satisfies ExportedHandler<PdfValidationSpikeEnvironment>;
