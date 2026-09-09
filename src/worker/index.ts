import { createSpikeDocument } from "../document/create-spike-document";
import { sha256Hex } from "../document/hash";
import { bytesToBase64 } from "../document/base64";
import { makeSyntheticSignature } from "../spike/synthetic-signature";
import syntheticPhotoBytes from "../spike/fixtures/synthetic-photo.jpg";

// These replace browser-supplied image bytes for this synthetic spike. Keeping
// fixture creation outside fetch prevents it from distorting request profiles.
const SPIKE_IMAGES = {
  photo: new Uint8Array(syntheticPhotoBytes),
  signature: makeSyntheticSignature(),
};

const MAXIMUM_PDF_BYTES = 5_000_000;

interface SpikeEnvironment {
  SPIKE_DOCUMENTS: R2Bucket;
  RESEND_API_KEY?: string;
  RESEND_TEST_FROM?: string;
  RESEND_TEST_TO?: string;
  SPIKE_TRIGGER_TOKEN?: string;
}

interface ResendResponse {
  id?: string;
  message?: string;
  name?: string;
}

function authorized(request: Request, expectedToken: string | undefined): boolean {
  if (!expectedToken) return false;
  const supplied = request.headers.get("authorization");
  if (!supplied?.startsWith("Bearer ")) return false;

  const actualBytes = new TextEncoder().encode(supplied.slice("Bearer ".length));
  const expectedBytes = new TextEncoder().encode(expectedToken);
  if (actualBytes.length !== expectedBytes.length) return false;

  let difference = 0;
  for (let index = 0; index < actualBytes.length; index += 1) {
    difference |= actualBytes[index] ^ expectedBytes[index];
  }
  return difference === 0;
}

function resendConfiguration(environment: SpikeEnvironment): {
  apiKey: string;
  from: string;
  to: string;
} | undefined {
  const { RESEND_API_KEY: apiKey, RESEND_TEST_FROM: from, RESEND_TEST_TO: to } = environment;
  return apiKey && from && to ? { apiKey, from, to } : undefined;
}

function isPdf(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-";
}

export default {
  async fetch(request, environment?: SpikeEnvironment): Promise<Response> {
    const url = new URL(request.url);

    if (["GET", "HEAD"].includes(request.method) && url.pathname.startsWith("/api/spike/attachment/")) {
      if (!environment) return new Response("Not found", { status: 404 });
      const capability = url.pathname.slice("/api/spike/attachment/".length);
      if (!/^[0-9a-f]{64}$/.test(capability)) return new Response("Not found", { status: 404 });

      const objectKey = `synthetic/${capability}.pdf`;
      const object = request.method === "HEAD"
        ? await environment.SPIKE_DOCUMENTS.head(objectKey)
        : await environment.SPIKE_DOCUMENTS.get(objectKey);
      if (!object) return new Response("Not found", { status: 404 });
      const headers = {
        "cache-control": "private, no-store",
        "content-disposition": "attachment; filename=sealproof-synthetic-spike.pdf",
        "content-type": "application/pdf",
        "x-content-type-options": "nosniff",
        "x-sealproof-sha256": object.customMetadata?.sha256 ?? "",
      };

      if (request.method === "HEAD") return new Response(null, { headers });
      const bodyObject = object as R2ObjectBody;
      return new Response(bodyObject.body, { headers });
    }

    if (request.method === "POST" && url.pathname === "/api/spike/resend") {
      if (!environment || !authorized(request, environment.SPIKE_TRIGGER_TOKEN)) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      const resend = resendConfiguration(environment);
      if (!resend) return Response.json({ error: "Resend secrets are incomplete" }, { status: 503 });
      if (request.headers.get("content-type") !== "application/pdf") {
        return Response.json({ error: "Expected application/pdf" }, { status: 415 });
      }

      const pdfBytes = new Uint8Array(await request.arrayBuffer());
      if (pdfBytes.length > MAXIMUM_PDF_BYTES) {
        return Response.json({ error: "PDF exceeds 5 MB" }, { status: 413 });
      }
      if (!isPdf(pdfBytes)) return Response.json({ error: "Body is not a PDF" }, { status: 400 });

      const capabilityBytes = crypto.getRandomValues(new Uint8Array(32));
      const capability = Array.from(capabilityBytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
      const objectKey = `synthetic/${capability}.pdf`;
      const hash = await sha256Hex(pdfBytes);
      await environment.SPIKE_DOCUMENTS.put(objectKey, pdfBytes, {
        httpMetadata: { contentType: "application/pdf" },
        customMetadata: { sha256: hash, synthetic: "true" },
      });

      const attachmentUrl = new URL(`/api/spike/attachment/${capability}`, url).toString();
      const resendResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${resend.apiKey}`,
          "content-type": "application/json",
          "idempotency-key": `sealproof-spike-${capability}`,
        },
        body: JSON.stringify({
          from: resend.from,
          to: [resend.to],
          subject: "SEALPROOF synthetic attachment spike",
          text: `Synthetic test only. Expected PDF SHA-256: ${hash}`,
          attachments: [{ path: attachmentUrl, filename: "sealproof-synthetic-spike.pdf" }],
        }),
      });
      const resendResult = await resendResponse.json<ResendResponse>();

      if (!resendResponse.ok || !resendResult.id) {
        await environment.SPIKE_DOCUMENTS.delete(objectKey);
        return Response.json({
          error: "Resend rejected the request",
          providerStatus: resendResponse.status,
          providerError: resendResult.message ?? resendResult.name ?? "Unknown error",
        }, { status: 502 });
      }

      return Response.json({
        byteLength: pdfBytes.length,
        hash,
        providerId: resendResult.id,
        capability,
        temporaryObjectRetained: true,
      });
    }

    if (request.method === "DELETE" && url.pathname.startsWith("/api/spike/resend/")) {
      if (!environment || !authorized(request, environment.SPIKE_TRIGGER_TOKEN)) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      const capability = url.pathname.slice("/api/spike/resend/".length);
      if (!/^[0-9a-f]{64}$/.test(capability)) {
        return Response.json({ error: "Invalid capability" }, { status: 400 });
      }

      const objectKey = `synthetic/${capability}.pdf`;
      await environment.SPIKE_DOCUMENTS.delete(objectKey);
      const deleted = (await environment.SPIKE_DOCUMENTS.head(objectKey)) === null;
      return Response.json({ deleted });
    }

    if (request.method === "POST" && url.pathname === "/api/spike/hash") {
      if (request.headers.get("content-type") !== "application/pdf") {
        return Response.json({ error: "Expected application/pdf" }, { status: 415 });
      }

      const declaredLength = Number(request.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > MAXIMUM_PDF_BYTES) {
        return Response.json({ error: "PDF exceeds 5 MB" }, { status: 413 });
      }

      const pdfBytes = new Uint8Array(await request.arrayBuffer());
      if (pdfBytes.length > MAXIMUM_PDF_BYTES) {
        return Response.json({ error: "PDF exceeds 5 MB" }, { status: 413 });
      }
      if (!isPdf(pdfBytes)) {
        return Response.json({ error: "Body is not a PDF" }, { status: 400 });
      }

      return Response.json({
        byteLength: pdfBytes.length,
        sha256: await sha256Hex(pdfBytes),
      });
    }

    if (request.method === "POST" && url.pathname === "/api/spike/storage-encoding") {
      if (!environment) {
        return Response.json({ error: "R2 binding is unavailable" }, { status: 503 });
      }
      if (request.headers.get("content-type") !== "application/pdf") {
        return Response.json({ error: "Expected application/pdf" }, { status: 415 });
      }

      const pdfBytes = new Uint8Array(await request.arrayBuffer());
      if (pdfBytes.length > MAXIMUM_PDF_BYTES) {
        return Response.json({ error: "PDF exceeds 5 MB" }, { status: 413 });
      }
      if (!isPdf(pdfBytes)) {
        return Response.json({ error: "Body is not a PDF" }, { status: 400 });
      }

      const objectKey = `synthetic/${crypto.randomUUID()}.pdf`;
      const inputHash = await sha256Hex(pdfBytes);
      let deleted = false;

      try {
        await environment.SPIKE_DOCUMENTS.put(objectKey, pdfBytes, {
          httpMetadata: { contentType: "application/pdf" },
          customMetadata: { sha256: inputHash, synthetic: "true" },
        });
        const storedObject = await environment.SPIKE_DOCUMENTS.get(objectKey);
        if (!storedObject) throw new Error("Synthetic R2 object was not found after upload");

        const storedBytes = new Uint8Array(await storedObject.arrayBuffer());
        const storedHash = await sha256Hex(storedBytes);
        const attachmentContent = bytesToBase64(storedBytes);
        const resendCompatibleBody = JSON.stringify({
          attachments: [{
            content: attachmentContent,
            filename: "sealproof-synthetic-spike.pdf",
          }],
        });

        return Response.json({
          byteLength: storedBytes.length,
          inputHash,
          storedHash,
          base64Length: attachmentContent.length,
          resendBodyBytes: new TextEncoder().encode(resendCompatibleBody).length,
          hashesMatch: inputHash === storedHash,
        });
      } finally {
        await environment.SPIKE_DOCUMENTS.delete(objectKey);
        deleted = (await environment.SPIKE_DOCUMENTS.head(objectKey)) === null;
        if (!deleted) throw new Error("Synthetic R2 object deletion could not be verified");
      }
    }

    if (request.method !== "GET" || url.pathname !== "/spike/document") {
      return new Response("Not found", { status: 404 });
    }

    const pdfBytes = await createSpikeDocument(SPIKE_IMAGES);
    const hash = await sha256Hex(pdfBytes);

    const responseBody = new Uint8Array(pdfBytes).buffer;

    return new Response(responseBody, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": "attachment; filename=sealproof-spike.pdf",
        "x-sealproof-sha256": hash,
      },
    });
  },
} satisfies ExportedHandler<SpikeEnvironment>;
