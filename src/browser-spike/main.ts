import { createSpikeDocument } from "../document/create-spike-document";
import { sha256Hex } from "../document/hash";
import { makeSyntheticSignature } from "../spike/synthetic-signature";
import photoUrl from "../spike/fixtures/synthetic-photo.jpg?url";

interface HashResponse {
  byteLength: number;
  sha256: string;
}

const runButton = document.querySelector<HTMLButtonElement>("#run");
const result = document.querySelector<HTMLPreElement>("#result");

if (!runButton || !result) throw new Error("Spike controls are missing");

const sendButton = document.querySelector<HTMLButtonElement>("#send");
const cleanupButton = document.querySelector<HTMLButtonElement>("#cleanup");
const tokenInput = document.querySelector<HTMLInputElement>("#trigger-token");
const sendResult = document.querySelector<HTMLPreElement>("#send-result");
if (!sendButton || !cleanupButton || !tokenInput || !sendResult) {
  throw new Error("Resend spike controls are missing");
}

let retainedCapability: string | undefined;

async function createSyntheticPdf(): Promise<Uint8Array> {
  const photoResponse = await fetch(photoUrl);
  if (!photoResponse.ok) throw new Error("Synthetic photo could not be loaded");
  return createSpikeDocument({
    photo: new Uint8Array(await photoResponse.arrayBuffer()),
    signature: makeSyntheticSignature(),
  });
}

runButton.addEventListener("click", async () => {
  runButton.disabled = true;
  result.textContent = "Generating the PDF in this browser…";

  try {
    const pdfBytes = await createSyntheticPdf();
    const browserHash = await sha256Hex(pdfBytes);

    result.textContent = "Uploading the exact PDF bytes for an independent Worker hash…";
    const hashResponse = await fetch("/api/spike/hash", {
      method: "POST",
      headers: { "content-type": "application/pdf" },
      body: new Blob([new Uint8Array(pdfBytes)], { type: "application/pdf" }),
    });
    if (!hashResponse.ok) throw new Error(`Worker returned HTTP ${hashResponse.status}`);

    const workerResult = await hashResponse.json() as HashResponse;
    const matches = browserHash === workerResult.sha256 && pdfBytes.length === workerResult.byteLength;

    result.textContent = [
      `Result: ${matches ? "PASS" : "FAIL"}`,
      `Bytes: ${pdfBytes.length}`,
      `Browser SHA-256: ${browserHash}`,
      `Worker SHA-256:  ${workerResult.sha256}`,
      "Storage: none",
      "Email: none",
    ].join("\n");
  } catch (error) {
    result.textContent = `Result: ERROR\n${error instanceof Error ? error.message : String(error)}`;
  } finally {
    runButton.disabled = false;
  }
});

sendButton.addEventListener("click", async () => {
  sendButton.disabled = true;
  cleanupButton.disabled = true;
  sendResult.textContent = "Generating and submitting one synthetic PDF…";

  try {
    if (!tokenInput.value) throw new Error("Enter the configured trigger token");
    const pdfBytes = await createSyntheticPdf();
    const response = await fetch("/api/spike/resend", {
      method: "POST",
      headers: {
        authorization: `Bearer ${tokenInput.value}`,
        "content-type": "application/pdf",
      },
      body: new Blob([new Uint8Array(pdfBytes)], { type: "application/pdf" }),
    });
    const responseBody = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(JSON.stringify(responseBody));

    retainedCapability = String(responseBody.capability);
    cleanupButton.disabled = false;
    sendResult.textContent = [
      "Result: RESEND ACCEPTED",
      `Bytes: ${responseBody.byteLength}`,
      `SHA-256: ${responseBody.hash}`,
      `Provider ID: ${responseBody.providerId}`,
      "Temporary synthetic PDF: retained until you verify and click delete",
    ].join("\n");
  } catch (error) {
    sendResult.textContent = `Result: ERROR\n${error instanceof Error ? error.message : String(error)}`;
  } finally {
    sendButton.disabled = false;
  }
});

cleanupButton.addEventListener("click", async () => {
  if (!retainedCapability) return;
  cleanupButton.disabled = true;
  sendResult.textContent += "\nDeleting and verifying deletion…";

  try {
    const response = await fetch(`/api/spike/resend/${retainedCapability}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${tokenInput.value}` },
    });
    const responseBody = await response.json() as { deleted?: boolean };
    if (!response.ok || responseBody.deleted !== true) throw new Error("Deletion was not verified");
    retainedCapability = undefined;
    sendResult.textContent += "\nTemporary synthetic PDF: DELETED (verified)";
  } catch (error) {
    sendResult.textContent += `\nCleanup error: ${error instanceof Error ? error.message : String(error)}`;
    cleanupButton.disabled = false;
  }
});
