import { createSpikeDocument } from "../document/create-spike-document";
import { sha256Hex } from "../document/hash";
import {
  makeSyntheticPhoto,
  makeSyntheticSignature,
} from "../document/synthetic-images";

// These replace browser-supplied image bytes for this synthetic spike. Keeping
// fixture creation outside fetch prevents it from distorting request profiles.
const SPIKE_IMAGES = {
  photo: makeSyntheticPhoto(),
  signature: makeSyntheticSignature(),
};

export default {
  async fetch(request): Promise<Response> {
    const url = new URL(request.url);

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
} satisfies ExportedHandler;
