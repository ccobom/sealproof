import { needsDeliveryUpdates, startStatusPolling } from "./status-polling";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  productionSetupSchema,
  SYNTHETIC_RELEASE_TEXT,
  todayForDateInput,
  type ProductionSetup,
} from "./production-setup";
import { signerDetailsSchema, type SignerDetails } from "./signer-details";
import { PhotoCapture } from "./PhotoCapture";
import { SignatureCapture } from "./SignatureCapture";
import { validateSignature, type Signature } from "../document/signature-contract";
import { FinalizationRequestError } from "./finalization-client";
import type { FinalizedRelease, ReleaseStatus } from "./finalization-client";
import type { LocalFakeDeliveryEvent } from "./finalization-client";
import { TurnstileChallenge } from "./TurnstileChallenge";
import type { PublicConfig } from "./public-config-client";
import { retryCountLabel } from "./retry-copy";

type Screen = "setup" | "preview" | "handoff" | "signer" | "photo" | "signature" | "finalReview" | "sealedLocal" | "productionCloseout" | "localComplete";

const LOCAL_RUNTIME_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

const INITIAL_SETUP: ProductionSetup = {
  productionName: "",
  signatureCollector: "",
  productionEmail: "",
  projectTitle: "",
  agreementDate: todayForDateInput(),
  photoRequired: true,
};

function initialSignerDetails(agreementDate: string): SignerDetails {
  return { signerName: "", signerEmail: "", signedDate: agreementDate, agreed: false };
}

export function App() {
  const [screen, setScreen] = useState<Screen>("setup");
  const [setup, setSetup] = useState(INITIAL_SETUP);
  const [signer, setSigner] = useState<SignerDetails>(() => initialSignerDetails(INITIAL_SETUP.agreementDate));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [signerErrors, setSignerErrors] = useState<Record<string, string>>({});
  const [signerPhoto, setSignerPhoto] = useState<Uint8Array>();
  const [photoError, setPhotoError] = useState<string>();
  const [signature, setSignature] = useState<Signature>();
  const [signatureError, setSignatureError] = useState<string>();
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [previewBytes, setPreviewBytes] = useState<Uint8Array>();
  const [finalPdfUrl, setFinalPdfUrl] = useState<string>();
  const [finalPdfBytes, setFinalPdfBytes] = useState<Uint8Array>();
  const [finalPdfHash, setFinalPdfHash] = useState<string>();
  const [finalizedRelease, setFinalizedRelease] = useState<FinalizedRelease>();
  const [releaseStatus, setReleaseStatus] = useState<ReleaseStatus>();
  const [retryingRole, setRetryingRole] = useState<"PRODUCTION" | "SIGNER">();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [publicConfig, setPublicConfig] = useState<PublicConfig>();
  const [turnstileToken, setTurnstileToken] = useState<string>();
  const [turnstileResetVersion, setTurnstileResetVersion] = useState(0);
  const finalizationPending = releaseStatus?.releaseState === "FINALIZING"
    || (!releaseStatus && finalizedRelease?.outcome === "pending_recovery");
  const localRuntime = LOCAL_RUNTIME_HOSTS.has(window.location.hostname);
  const updateTurnstileToken = useCallback((token: string | undefined) => {
    setTurnstileToken(token);
  }, []);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  useEffect(() => () => {
    if (finalPdfUrl) URL.revokeObjectURL(finalPdfUrl);
  }, [finalPdfUrl]);

  useEffect(() => {
    if (localRuntime || screen !== "finalReview" || publicConfig) return;
    let active = true;
    void import("./public-config-client").then(({ loadPublicConfig }) => loadPublicConfig())
      .then((configuration) => {
        if (active) publicConfig === undefined && setPublicConfig(configuration);
      })
      .catch(() => {
        if (active) setFailure("SealProof's live-test configuration is unavailable. Your reviewed PDF remains only in this browser.");
      });
    return () => { active = false; };
  }, [localRuntime, publicConfig, screen]);

  const polling = useRef<ReturnType<typeof startStatusPolling> | undefined>(undefined);
  const shouldPoll = !localRuntime && !!finalizedRelease && !finalizationPending
    && (screen === "sealedLocal" || screen === "productionCloseout")
    && needsDeliveryUpdates(releaseStatus);
  useEffect(() => {
    if (!shouldPoll || !finalizedRelease) return;
    const controller = startStatusPolling({
      expiresAt: finalizedRelease.expiresAt,
      visibility: document,
      read: async () => {
        const { requestReleaseStatus } = await import("./finalization-client");
        return requestReleaseStatus(finalizedRelease);
      },
      update: setReleaseStatus,
      failed: () => setFailure("Delivery status could not be refreshed. Checks will resume while this page is visible; the original expiration is unchanged."),
    });
    polling.current = controller;
    return () => { controller.stop(); polling.current = undefined; };
  }, [shouldPoll, finalizedRelease]);

  function update(field: keyof ProductionSetup, value: string) {
    setSetup((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: "" }));
  }

  async function generatePreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailure(undefined);
    const parsed = productionSetupSchema.safeParse(setup);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? "form");
        fieldErrors[field] ??= issue.message;
      }
      setErrors(fieldErrors);
      document.getElementById(String(parsed.error.issues[0]?.path[0]))?.focus();
      return;
    }

    setBusy(true);
    try {
      const [{ createSetupPreviewDocument }, { validateFinalPdf }] = await Promise.all([
        import("../document/create-setup-preview"),
        import("../document/pdf-contract"),
      ]);
      const bytes = await createSetupPreviewDocument(parsed.data, SYNTHETIC_RELEASE_TEXT);
      const contract = await validateFinalPdf(bytes);
      if (!contract.valid) throw new Error(`Generated PDF failed contract: ${contract.reason}`);
      const ownedBytes = new Uint8Array(bytes);
      const blob = new Blob([ownedBytes.buffer as ArrayBuffer], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setSetup(parsed.data);
      setPreviewBytes(ownedBytes);
      setPreviewUrl(url);
      setScreen("preview");
      window.scrollTo(0, 0);
    } catch {
      setFailure("SealProof could not generate a valid preview. No document was saved or sent.");
    } finally {
      setBusy(false);
    }
  }

  function editSetup() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(undefined);
    setPreviewBytes(undefined);
    setScreen("setup");
    window.scrollTo(0, 0);
  }

  function show(next: Screen) {
    setScreen(next);
    window.scrollTo(0, 0);
  }

  async function beginHandoff() {
    setBusy(true);
    setFailure(undefined);
    try {
      const response = await fetch("/api/delivery-availability", { credentials: "omit", cache: "no-store" });
      if (!response.ok || (await response.json() as { available?: unknown }).available !== true) throw new Error("unavailable");
    } catch {
      setFailure("Delivery is temporarily unavailable. Please try again later. Nothing has been uploaded, emailed, or scheduled.");
      return;
    } finally {
      setBusy(false);
    }
    setSigner(initialSignerDetails(setup.agreementDate));
    setSignerErrors({});
    show("handoff");
  }

  function updateSigner<K extends keyof SignerDetails>(field: K, value: SignerDetails[K]) {
    setSigner((current) => ({ ...current, [field]: value }));
    setSignerErrors((current) => ({ ...current, [field]: "" }));
  }

  function completeSignerReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = signerDetailsSchema.safeParse(signer);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? "form");
        fieldErrors[field] ??= issue.message;
      }
      setSignerErrors(fieldErrors);
      document.getElementById(String(parsed.error.issues[0]?.path[0]))?.focus();
      return;
    }
    setSigner(parsed.data);
    setSetup((current) => ({ ...current, agreementDate: parsed.data.signedDate }));
    show("photo");
  }

  function completePhotoStep() {
    if (!signerPhoto && setup.photoRequired) {
      setPhotoError("Take and approve a photo before continuing.");
      return;
    }
    setPhotoError(undefined);
    show("signature");
  }

  async function completeSignatureStep() {
    try {
      if (!signature) throw new Error("missing");
      validateSignature(signature);
      setSignatureError(undefined);
      setBusy(true);
      const [{ createFinalReleaseDocument }, { validateFinalPdf }, { sha256Hex }] = await Promise.all([
        import("../document/create-final-release"),
        import("../document/pdf-contract"),
        import("../document/hash"),
      ]);
      const bytes = await createFinalReleaseDocument({
        setup,
        signer,
        releaseText: SYNTHETIC_RELEASE_TEXT,
        photo: signerPhoto,
        signature,
      });
      const contract = await validateFinalPdf(bytes);
      if (!contract.valid) throw new Error(`Generated PDF failed contract: ${contract.reason}`);
      const ownedBytes = new Uint8Array(bytes);
      const hash = await sha256Hex(ownedBytes);
      const blob = new Blob([ownedBytes.buffer as ArrayBuffer], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      if (finalPdfUrl) URL.revokeObjectURL(finalPdfUrl);
      setFinalPdfBytes(ownedBytes);
      setFinalPdfHash(hash);
      setFinalPdfUrl(url);
      show("finalReview");
    } catch {
      setSignatureError(signature ? "SealProof could not generate a valid final test PDF. Nothing was uploaded or sealed." : "Draw a signature before continuing.");
    } finally {
      setBusy(false);
    }
  }

  function correctSignerInputs() {
    if (finalPdfUrl) URL.revokeObjectURL(finalPdfUrl);
    setFinalPdfUrl(undefined);
    setFinalPdfBytes(undefined);
    setFinalPdfHash(undefined);
    setSignerPhoto(undefined);
    setSignature(undefined);
    setPhotoError(undefined);
    setSignatureError(undefined);
    show("signer");
  }

  async function sealRelease() {
    if (finalizedRelease || !finalPdfBytes || !finalPdfHash || (!localRuntime && !turnstileToken)) return;
    setBusy(true);
    setFailure(undefined);
    try {
      const { requestFinalizationAdmission, uploadReviewedPdf } = await import("./finalization-client");
      const { retainReleaseAndLoadStatus } = await import("./retain-release");
      const admission = await requestFinalizationAdmission({
        productionEmail: setup.productionEmail,
        signerEmail: signer.signerEmail,
        browserDocumentHash: finalPdfHash,
        turnstileToken: localRuntime ? "local-synthetic-challenge-proof" : turnstileToken!,
      });
      const release = await uploadReviewedPdf(finalPdfBytes, finalPdfHash, admission.ticket);
      const status = await retainReleaseAndLoadStatus(release, (retained) => {
        setFinalizedRelease(retained);
        setReleaseStatus(undefined);
        show("sealedLocal");
      });
      setReleaseStatus(status);
      if (!status) setFailure("Your release controls are available, but delivery status could not be loaded. Email may already have been sent. Refresh status for this release; do not create another release.");
    } catch (error) {
      setFailure(error instanceof FinalizationRequestError && error.status === 503
        && ["admission", "upload", "retry"].includes(error.stage)
        ? "Delivery is temporarily unavailable. Please try again later; no delivery has been scheduled by this action."
        : localRuntime
        ? "The local sealing test did not complete. Your reviewed PDF remains in this browser; no successful closeout has been claimed."
        : "The live sealing test did not complete. Your reviewed PDF remains in this browser; no successful closeout has been claimed. Complete a fresh anti-abuse check before retrying.");
      if (!localRuntime) {
        setTurnstileToken(undefined);
        setTurnstileResetVersion((value) => value + 1);
      }
    } finally {
      setBusy(false);
    }
  }

  async function recoverExistingRelease() {
    if (!finalizedRelease || busy) return;
    setBusy(true);
    setFailure(undefined);
    try {
      const { recoverFinalization, requestReleaseStatus } = await import("./finalization-client");
      const outcome = await recoverFinalization(finalizedRelease);
      if (outcome === "waiting_for_pdf") {
        setFailure("The stored PDF is not available yet. Finalization remains incomplete and recovery has not sent email. You may try recovery again or close this release; its original expiration is unchanged.");
        return;
      }
      const recovered = { ...finalizedRelease, outcome: "sealed" as const };
      setFinalizedRelease(recovered);
      setReleaseStatus(undefined);
      try {
        setReleaseStatus(await requestReleaseStatus(recovered));
      } catch {
        setFailure("Finalization completed, but delivery status is unavailable. Email may already have been sent. Refresh status for this same release.");
      }
    } catch (error) {
      setFailure(error instanceof FinalizationRequestError && error.status === 503
        ? "Recovery is temporarily unavailable. Keep this release's controls and try again later; the original expiration is unchanged."
        : "Recovery could not confirm finalization. Refresh status before trying again. If the stored PDF cannot be verified, close this release; do not assume it was sealed or emailed.");
    } finally {
      setBusy(false);
    }
  }

  async function refreshReleaseStatus() {
    if (!finalizedRelease) return;
    setBusy(true);
    setFailure(undefined);
    try {
      if (polling.current) {
        await polling.current.refresh();
      } else {
        const { requestReleaseStatus } = await import("./finalization-client");
        setReleaseStatus(await requestReleaseStatus(finalizedRelease));
      }
    } catch {
      setFailure("Status is still unavailable. Your release controls remain available and the original expiration is unchanged. Email may already have been sent.");
    } finally {
      setBusy(false);
    }
  }

  async function closeLocalRelease() {
    if (!finalizedRelease) return;
    setBusy(true);
    setFailure(undefined);
    try {
      const { closeoutRelease } = await import("./finalization-client");
      await closeoutRelease(finalizedRelease);
      setFinalizedRelease(undefined);
      setReleaseStatus(undefined);
      show("localComplete");
    } catch {
      setFailure(localRuntime
        ? "SealProof could not confirm deletion of the local Worker copy. Access is not represented as closed; please retry."
        : "SealProof could not confirm deletion of its temporary copy. The release is not represented as closed; please retry.");
    } finally {
      setBusy(false);
    }
  }

  async function simulateLocalDelivery(
    productionEvent: LocalFakeDeliveryEvent,
    signerEvent: LocalFakeDeliveryEvent,
  ) {
    if (!localRuntime || !finalizedRelease) return;
    setBusy(true);
    setFailure(undefined);
    try {
      const { sendLocalFakeDeliveryEvent, requestReleaseStatus } = await import("./finalization-client");
      await sendLocalFakeDeliveryEvent(finalizedRelease, "PRODUCTION", productionEvent);
      await sendLocalFakeDeliveryEvent(finalizedRelease, "SIGNER", signerEvent);
      setReleaseStatus(await requestReleaseStatus(finalizedRelease));
    } catch {
      try {
        const { requestReleaseStatus } = await import("./finalization-client");
        setReleaseStatus(await requestReleaseStatus(finalizedRelease));
      } catch {
        // Preserve the last known bounded state if even the follow-up status request fails.
      }
      setFailure("The complete fake webhook scenario did not finish. The status shown is the latest state SealProof could verify; no live service was contacted.");
    } finally {
      setBusy(false);
    }
  }

  async function simulateLocalRetryEvent(eventType: LocalFakeDeliveryEvent) {
    if (!retryingRole || !finalizedRelease) return;
    setBusy(true);
    setFailure(undefined);
    try {
      const { sendLocalFakeDeliveryEvent, requestReleaseStatus } = await import("./finalization-client");
      await sendLocalFakeDeliveryEvent(finalizedRelease, retryingRole, eventType);
      setReleaseStatus(await requestReleaseStatus(finalizedRelease));
      setRetryingRole(undefined);
    } catch {
      setFailure("The fake retry webhook did not complete. No live service was contacted.");
    } finally {
      setBusy(false);
    }
  }

  async function retryLocalDelivery(recipientRole: "PRODUCTION" | "SIGNER") {
    if (!finalizedRelease) return;
    setBusy(true);
    setFailure(undefined);
    try {
      const { retryFailedDelivery, requestReleaseStatus } = await import("./finalization-client");
      const result = await retryFailedDelivery(finalizedRelease, recipientRole);
      setReleaseStatus(await requestReleaseStatus(finalizedRelease));
      if (result.outcome === "accepted") {
        setRetryingRole(recipientRole);
        if (!localRuntime) show("sealedLocal");
      } else {
        setFailure(localRuntime
          ? "The new retry attempt exists but fake provider acceptance is still pending. You may retry this action; the original PDF and expiry are unchanged."
          : "The new retry attempt exists but provider acceptance is still pending. You may retry this action; the original PDF and expiry are unchanged.");
      }
    } catch (error) {
      setFailure(error instanceof FinalizationRequestError && error.status === 503
        ? "Delivery is temporarily unavailable. Please try again later; no delivery has been scheduled by this action."
        : localRuntime
        ? "SealProof could not create or recover the fake retry attempt. The original PDF and expiry are unchanged."
        : "SealProof could not create or recover the delivery retry. The original PDF and expiry are unchanged.");
    } finally {
      setBusy(false);
    }
  }

  function clearLocalTest() {
    previewBytes?.fill(0);
    finalPdfBytes?.fill(0);
    signerPhoto?.fill(0);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(undefined);
    setPreviewBytes(undefined);
    if (finalPdfUrl) URL.revokeObjectURL(finalPdfUrl);
    setFinalPdfUrl(undefined);
    setFinalPdfBytes(undefined);
    setFinalPdfHash(undefined);
    setFinalizedRelease(undefined);
    setReleaseStatus(undefined);
    setRetryingRole(undefined);
    setTurnstileToken(undefined);
    setTurnstileResetVersion(0);
    const freshSetup = { ...INITIAL_SETUP, agreementDate: todayForDateInput() };
    setSetup(freshSetup);
    setSigner(initialSignerDetails(freshSetup.agreementDate));
    setSignerPhoto(undefined);
    setSignature(undefined);
    setSignatureError(undefined);
    setErrors({});
    setSignerErrors({});
    setFailure(undefined);
    show("setup");
  }

  const progressStage = screen === "setup" ? 0 : screen === "preview" ? 1 : ["handoff", "signer"].includes(screen) ? 2 : 3;

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="wordmark" href="/" aria-label="SealProof home">SEALPROOF</a>
        <span className="build-label">{localRuntime ? "local build" : "controlled live test"}</span>
      </header>

      <div className="test-banner" role="note">
        {localRuntime
          ? "Local synthetic mode: use test information only. Nothing is emailed or sent to a live service."
          : "Controlled live test: use only email addresses you control and synthetic names, photos, signatures, and agreement content."}
      </div>

      <main>
        <ol className="progress" aria-label="Current progress">
          <li aria-current={screen === "setup" ? "step" : undefined} className={progressStage >= 0 ? "complete" : ""}>Production details</li>
          <li aria-current={screen === "preview" ? "step" : undefined} className={progressStage >= 1 ? "complete" : ""}>Setup preview</li>
          <li aria-current={["handoff", "signer"].includes(screen) ? "step" : undefined} className={progressStage >= 2 ? "complete" : ""}>Signer review</li>
          <li aria-current={["photo", "signature", "finalReview", "sealedLocal", "productionCloseout", "localComplete"].includes(screen) ? "step" : undefined} className={progressStage >= 3 ? "complete" : ""}>Evidence &amp; final review</li>
        </ol>

        {screen === "setup" ? (
          <section className="panel" aria-labelledby="setup-heading">
            <p className="eyebrow">Step 1 of 2 in this build</p>
            <h1 id="setup-heading">Prepare the release</h1>
            <p className="lede">Enter production details. SealProof will generate the exact local test document for your review.</p>

            <form onSubmit={generatePreview} noValidate>
              <Field label="Production or producer name" id="productionName" required error={errors.productionName}>
                <input id="productionName" autoComplete="organization" value={setup.productionName} onChange={(event) => update("productionName", event.target.value)} aria-describedby={errors.productionName ? "productionName-error" : undefined} />
              </Field>
              <Field label="Signature collection by" hint="Optional — leave blank if this is the producer above." id="signatureCollector" error={errors.signatureCollector}>
                <input id="signatureCollector" autoComplete="name" value={setup.signatureCollector} onChange={(event) => update("signatureCollector", event.target.value)} aria-describedby={errors.signatureCollector ? "signatureCollector-error" : "signatureCollector-hint"} />
              </Field>
              <Field label="Production email" id="productionEmail" required error={errors.productionEmail}>
                <input id="productionEmail" type="email" autoComplete="email" inputMode="email" value={setup.productionEmail} onChange={(event) => update("productionEmail", event.target.value)} aria-describedby={errors.productionEmail ? "productionEmail-error" : undefined} />
              </Field>
              <Field label="Project title" id="projectTitle" required error={errors.projectTitle}>
                <input id="projectTitle" value={setup.projectTitle} onChange={(event) => update("projectTitle", event.target.value)} aria-describedby={errors.projectTitle ? "projectTitle-error" : undefined} />
              </Field>
              <Field label="Agreement date" hint="The signer will be able to confirm or correct this date." id="agreementDate" required error={errors.agreementDate}>
                <input id="agreementDate" type="date" value={setup.agreementDate} onChange={(event) => update("agreementDate", event.target.value)} aria-describedby={errors.agreementDate ? "agreementDate-error" : "agreementDate-hint"} />
              </Field>
              <div className="consent-field production-option">
                <label htmlFor="photoRequired">
                  <input id="photoRequired" type="checkbox" checked={setup.photoRequired} onChange={(event) => setSetup((current) => ({ ...current, photoRequired: event.target.checked }))} />
                  <span><strong>Require a current signer photograph</strong><small>Turn this off if a photograph is unnecessary for this release. The choice will be shown to the signer and recorded in the document.</small></span>
                </label>
              </div>

              <div className="release-copy" aria-labelledby="release-heading">
                <div>
                  <p className="field-label" id="release-heading">Release text</p>
                  <span className="locked-label">Locked test fixture</span>
                </div>
                <pre>{SYNTHETIC_RELEASE_TEXT}</pre>
              </div>

              {failure && <p className="error-summary" role="alert">{failure}</p>}
              <button className="primary-button" type="submit" disabled={busy}>
                {busy ? "Generating preview…" : "Generate exact preview"}
              </button>
            </form>
          </section>
        ) : screen === "preview" ? (
          <section className="panel preview-panel" aria-labelledby="preview-heading">
            <p className="eyebrow">Step 2 of 2 in this build</p>
            <h1 id="preview-heading">Review the setup document</h1>
            <p className="lede">These are the exact PDF bytes generated from production's current setup. Signer details and evidence will be added only in later reviewed steps.</p>
            {previewUrl && <iframe className="pdf-preview" src={previewUrl} title="Generated test release PDF" />}
            <div className="preview-actions">
              <button className="secondary-button" type="button" onClick={editSetup}>Edit production details</button>
              {previewUrl && previewBytes && (
                <a className="primary-button" href={previewUrl} download="sealproof-test-preview.pdf">Download test PDF</a>
              )}
              <button className="primary-button" type="button" onClick={beginHandoff} disabled={busy}>{busy ? "Checking delivery availability?" : "Approve setup and hand off"}</button>
            </div>
          </section>
        ) : screen === "handoff" ? (
          <section className="panel handoff-panel" aria-labelledby="handoff-heading">
            <p className="eyebrow">Device handoff</p>
            <h1 id="handoff-heading">Please hand this device to the signer.</h1>
            <div className="handoff-card">
              <p><strong>Production:</strong> do not continue on the signer's behalf.</p>
              <p><strong>Signer:</strong> the next screen is for you. You will review the test release before entering any information.</p>
            </div>
            <button className="primary-button" type="button" onClick={() => show("signer")}>I am the signer</button>
          </section>
        ) : screen === "signer" ? (
          <section className="panel" aria-labelledby="signer-heading">
            <p className="eyebrow">Signer review</p>
            <h1 id="signer-heading">Review before you agree</h1>
            <p className="lede">Check who is collecting this release, what project it concerns, and every word of the test agreement.</p>

            <dl className="summary-grid">
              <div><dt>Production / producer</dt><dd>{setup.productionName}</dd></div>
              <div><dt>Collected by</dt><dd>{setup.signatureCollector || setup.productionName}</dd></div>
              <div><dt>Production email</dt><dd>{setup.productionEmail}</dd></div>
              <div><dt>Project</dt><dd>{setup.projectTitle}</dd></div>
              <div><dt>Signer photograph</dt><dd>{setup.photoRequired ? "Required" : "Waived by production"}</dd></div>
            </dl>

            <div className="release-copy signer-release" aria-labelledby="signer-release-heading">
              <div>
                <p className="field-label" id="signer-release-heading">Complete test release</p>
                <span className="locked-label">Not a legal agreement</span>
              </div>
              <pre>{SYNTHETIC_RELEASE_TEXT}</pre>
            </div>

            <form onSubmit={completeSignerReview} noValidate autoComplete="off">
              <Field label="Your full name" id="signerName" required error={signerErrors.signerName}>
                <input id="signerName" name="sealproofSignerName" autoComplete="name" value={signer.signerName} onChange={(event) => updateSigner("signerName", event.target.value)} aria-describedby={signerErrors.signerName ? "signerName-error" : undefined} />
              </Field>
              <Field label="Your email" hint="This is where your completed copy will eventually be sent." id="signerEmail" required error={signerErrors.signerEmail}>
                <input id="signerEmail" name="sealproofSignerEmail" type="email" inputMode="email" autoComplete="email" value={signer.signerEmail} onChange={(event) => updateSigner("signerEmail", event.target.value)} aria-describedby={signerErrors.signerEmail ? "signerEmail-error" : "signerEmail-hint"} />
              </Field>
              <Field label="Agreement date" hint="Confirm or correct the date production entered." id="signedDate" required error={signerErrors.signedDate}>
                <input id="signedDate" name="sealproofSignedDate" type="date" value={signer.signedDate} onChange={(event) => updateSigner("signedDate", event.target.value)} aria-describedby={signerErrors.signedDate ? "signedDate-error" : "signedDate-hint"} />
              </Field>
              <div className="consent-field">
                <label htmlFor="agreed">
                  <input id="agreed" name="sealproofAgreement" type="checkbox" checked={signer.agreed} onChange={(event) => updateSigner("agreed", event.target.checked)} aria-describedby={signerErrors.agreed ? "agreed-error" : undefined} />
                  <span>I have read and agree to the complete test release shown above.</span>
                </label>
                {signerErrors.agreed && <p className="field-error" id="agreed-error" role="alert">{signerErrors.agreed}</p>}
              </div>
              <button className="primary-button" type="submit">Continue</button>
            </form>
          </section>
        ) : screen === "photo" ? (
          <section className="panel" aria-labelledby="photo-heading">
            <p className="eyebrow">Signer photograph</p>
            <h1 id="photo-heading">Take a current photo</h1>
            <p className="lede">{setup.photoRequired ? "Production requires a current signer photograph. SealProof will ask for camera access only when you enable it." : "Production marked the signer photograph as optional. You may take one, or continue without one."}</p>
            <PhotoCapture onPhotoChange={(photo) => { setSignerPhoto(photo); setPhotoError(undefined); }} />
            {photoError && <p className="error-summary" role="alert">{photoError}</p>}
            <button className="primary-button" type="button" onClick={completePhotoStep}>{signerPhoto ? "Approve photo and continue" : setup.photoRequired ? "Continue" : "Continue without a photo"}</button>
          </section>
        ) : screen === "signature" ? (
          <section className="panel" aria-labelledby="signature-heading">
            <p className="eyebrow">Signer signature</p>
            <h1 id="signature-heading">Draw your signature</h1>
            <p className="lede">Use a finger, stylus, or mouse. The drawing is retained as bounded vector points in this browser page; it is not uploaded or sealed.</p>
            <SignatureCapture onSignatureChange={(value) => { setSignature(value); setSignatureError(undefined); }} />
            {signatureError && <p className="error-summary" role="alert">{signatureError}</p>}
            <button className="primary-button" type="button" onClick={completeSignatureStep} disabled={busy}>{busy ? "Generating final test PDF…" : "Approve signature and generate PDF"}</button>
          </section>
        ) : screen === "finalReview" ? (
          <section className="panel preview-panel" aria-labelledby="final-review-heading">
            <p className="eyebrow">Exact PDF review</p>
            <h1 id="final-review-heading">Review the complete test document</h1>
            <p className="lede">This preview, download, and SHA-256 value all refer to the same PDF bytes. Review them before confirming the local test.</p>
            {localRuntime && (
              <div className="handoff-card">
                <p><strong>Local synthetic test:</strong> sealing will send these exact bytes only to the Worker running on this computer.</p>
                <p>The Worker will store an encrypted copy in local development storage until you complete the deletion step. Do not use real personal information.</p>
              </div>
            )}
            {!localRuntime && (
              <div className="handoff-card">
                <p><strong>Controlled live test:</strong> sealing uploads these exact PDF bytes to SealProof, which independently verifies their hash and stores only an encrypted temporary copy.</p>
                <p>Resend will retrieve and email separate copies to both entered addresses. SealProof deletes its temporary PDF and personal information at closeout or expiration, no later than two hours. Resend and recipient email providers retain their own copies independently.</p>
              </div>
            )}
            {finalPdfUrl && <iframe className="pdf-preview" src={finalPdfUrl} title="Complete local test release PDF" />}
            <div className="hash-card">
              <span>SHA-256</span>
              <code>{finalPdfHash}</code>
              <small>Identifies these exact PDF bytes; it does not prove identity or legal enforceability.</small>
            </div>
            <div className="preview-actions">
              <button className="secondary-button" type="button" onClick={correctSignerInputs}>Correct signer inputs</button>
              {finalPdfUrl && finalPdfBytes && (
                <a className="secondary-button" href={finalPdfUrl} download="sealproof-final-test.pdf">Download exact test PDF</a>
              )}
              {localRuntime ? (
                <button className="primary-button" type="button" onClick={sealRelease} disabled={busy}>
                  {busy ? "Sealing locally…" : "Seal this exact PDF locally"}
                </button>
              ) : (
                <>
                  {publicConfig ? (
                    <TurnstileChallenge
                      siteKey={publicConfig.turnstileSiteKey}
                      action={publicConfig.turnstileAction}
                      resetVersion={turnstileResetVersion}
                      onTokenChange={updateTurnstileToken}
                    />
                  ) : (
                    <p className="privacy-note">Loading the privacy-preserving anti-abuse check…</p>
                  )}
                  <button className="primary-button" type="button" onClick={sealRelease} disabled={busy || !turnstileToken}>
                    {busy ? "Sealing and submitting delivery…" : turnstileToken ? "Seal and send this exact PDF" : "Complete the anti-abuse check to seal"}
                  </button>
                </>
              )}
            </div>
            {failure && <p className="error-summary" role="alert">{failure}</p>}
          </section>
        ) : screen === "sealedLocal" ? (
          <section className="panel" aria-labelledby="sealed-local-heading">
            <p className="eyebrow">{finalizationPending ? "Finalization incomplete" : !releaseStatus ? "Release controls" : localRuntime ? "Encrypted local test" : "Contract sealed"}</p>
            <h1 id="sealed-local-heading">{finalizationPending
              ? "The release is not sealed yet."
              : !releaseStatus
              ? "Delivery status is unavailable."
              : localRuntime
              ? "The exact PDF is sealed in local storage."
              : releaseStatus?.releaseState === "DELIVERED"
                ? "Delivery confirmed."
                : releaseStatus?.releaseState === "DELIVERY_FAILED"
                  ? "A delivery failed."
                  : "The contract is sealed. Awaiting delivery."}</h1>
            <p className="lede">{finalizationPending
              ? "Finalization was interrupted. Recover this same release to verify the stored PDF and complete sealing before delivery. Its original expiration still applies. You can also hand the device back to production to close the release."
              : !releaseStatus
              ? "Keep this page open to manage the existing release. You can refresh status or hand the device back to production to download the PDF or close the release. The original expiration still applies."
              : localRuntime
              ? "The Worker independently matched the document hash and stored only encrypted PDF bytes. No email was sent and no live service was contacted."
              : releaseStatus?.releaseState === "DELIVERED"
                ? "Resend reports that both recipient copies were delivered. Please hand the device back to production."
                : releaseStatus?.releaseState === "DELIVERY_FAILED"
                  ? "The exact PDF remains available until closeout or its original expiration. Please hand the device back to production to choose the next action."
                : "SealProof independently matched the PDF hash and stored an encrypted temporary copy. It is attempting separate recipient submissions and checks for authenticated delivery updates automatically."}</p>
            <div className="handoff-card">
              <p><strong>Transaction:</strong> <code className="inline-hash">{finalizedRelease?.transactionId}</code></p>
              <p><strong>Worker status:</strong> {releaseStatus?.releaseState ?? "Unavailable"}</p>
              <p><strong>Production delivery:</strong> {releaseStatus?.productionDeliveryOutcome ?? "Unavailable"}</p>
              <p><strong>Signer delivery:</strong> {releaseStatus?.signerDeliveryOutcome ?? "Unavailable"}</p>
              <p><strong>SHA-256:</strong> <code className="inline-hash">{finalizedRelease?.documentHash}</code></p>
            </div>
            {finalizationPending && (
              <div className="preview-actions">
                <button className="primary-button" type="button" disabled={busy || !finalizedRelease || Date.now() >= finalizedRelease.expiresAt} onClick={recoverExistingRelease}>Recover this release</button>
              </div>
            )}
            {finalizedRelease && (
              <div className="preview-actions">
                <button className="secondary-button" type="button" disabled={busy} onClick={refreshReleaseStatus}>Refresh delivery status</button>
              </div>
            )}
            {localRuntime && (
              retryingRole
                ? (retryingRole === "PRODUCTION"
                  ? releaseStatus?.productionDeliveryOutcome === "PENDING"
                  : releaseStatus?.signerDeliveryOutcome === "PENDING")
                : releaseStatus?.releaseState === "SEALED_AWAITING_DELIVERY"
            ) && (
              <div className="local-simulation" aria-labelledby="local-simulation-heading">
                <h2 id="local-simulation-heading">Simulate authenticated delivery webhooks</h2>
                <p>{retryingRole ? `Choose the outcome for the new ${retryingRole.toLowerCase()} retry attempt.` : "Choose one synthetic outcome. These controls create locally signed, Resend-shaped events and send them through the real verification and state-transition code. No email or external request occurs."}</p>
                <div className="preview-actions">
                  {retryingRole ? (
                    <>
                      <button className="secondary-button" type="button" disabled={busy} onClick={() => simulateLocalRetryEvent("email.delivered")}>Retry delivered</button>
                      <button className="secondary-button" type="button" disabled={busy} onClick={() => simulateLocalRetryEvent("email.bounced")}>Retry failed again</button>
                    </>
                  ) : (
                    <>
                      <button className="secondary-button" type="button" disabled={busy} onClick={() => simulateLocalDelivery("email.delivered", "email.delivered")}>Both delivered</button>
                      <button className="secondary-button" type="button" disabled={busy} onClick={() => simulateLocalDelivery("email.delivered", "email.bounced")}>Production delivered; signer failed</button>
                      <button className="secondary-button" type="button" disabled={busy} onClick={() => simulateLocalDelivery("email.bounced", "email.delivered")}>Production failed; signer delivered</button>
                    </>
                  )}
                </div>
              </div>
            )}
            {localRuntime && releaseStatus?.releaseState === "DELIVERY_FAILED" && (
              <div className="preview-actions">
                {releaseStatus.productionSubmissionState === "PENDING_SUBMISSION" ? (
                  <button className="secondary-button" type="button" disabled={busy} onClick={() => retryLocalDelivery("PRODUCTION")}>Retry production submission</button>
                ) : releaseStatus.productionDeliveryOutcome === "FAILED" && releaseStatus.productionRetriesRemaining > 0 ? (
                  <>
                    <button className="secondary-button" type="button" disabled={busy} onClick={() => retryLocalDelivery("PRODUCTION")}>Retry production delivery</button>
                    <p className="privacy-note">Production: {retryCountLabel(releaseStatus.productionRetriesRemaining)}.</p>
                  </>
                ) : releaseStatus.productionDeliveryOutcome === "FAILED" ? (
                  <p className="privacy-note">Production: {retryCountLabel(releaseStatus.productionRetriesRemaining)}. You can still download the browser copy and delete SealProof's temporary storage.</p>
                ) : null}
                {releaseStatus.signerSubmissionState === "PENDING_SUBMISSION" ? (
                  <button className="secondary-button" type="button" disabled={busy} onClick={() => retryLocalDelivery("SIGNER")}>Retry signer submission</button>
                ) : releaseStatus.signerDeliveryOutcome === "FAILED" && releaseStatus.signerRetriesRemaining > 0 ? (
                  <>
                    <button className="secondary-button" type="button" disabled={busy} onClick={() => retryLocalDelivery("SIGNER")}>Retry signer delivery</button>
                    <p className="privacy-note">Signer: {retryCountLabel(releaseStatus.signerRetriesRemaining)}.</p>
                  </>
                ) : releaseStatus.signerDeliveryOutcome === "FAILED" ? (
                  <p className="privacy-note">Signer: {retryCountLabel(releaseStatus.signerRetriesRemaining)}. You can still download the browser copy and delete SealProof's temporary storage.</p>
                ) : null}
              </div>
            )}
            {localRuntime ? (
              <div className="preview-actions">
                {finalPdfUrl && finalPdfBytes && (
                  <a className="secondary-button" href={finalPdfUrl} download="sealproof-release.pdf">Download browser copy</a>
                )}
                <button className="primary-button" type="button" onClick={closeLocalRelease} disabled={busy}>
                  {busy ? "Deleting local Worker copy…" : "Delete Worker copy and close test"}
                </button>
              </div>
            ) : releaseStatus?.releaseState === "SEALED_AWAITING_DELIVERY" ? (
              <>
                {(releaseStatus.productionSubmissionState === "PENDING_SUBMISSION"
                  || releaseStatus.signerSubmissionState === "PENDING_SUBMISSION") && (
                  <div className="preview-actions">
                    {releaseStatus.productionSubmissionState === "PENDING_SUBMISSION" && (
                      <button className="secondary-button" type="button" disabled={busy} onClick={() => retryLocalDelivery("PRODUCTION")}>Retry production submission</button>
                    )}
                    {releaseStatus.signerSubmissionState === "PENDING_SUBMISSION" && (
                      <button className="secondary-button" type="button" disabled={busy} onClick={() => retryLocalDelivery("SIGNER")}>Retry signer submission</button>
                    )}
                    <p className="privacy-note">A submission step did not complete. The exact PDF, hash, and original expiration are unchanged; retrying uses the existing attempt and idempotency key.</p>
                  </div>
                )}
                <p className="privacy-note" role="status">Checking delivery status while this page is visible, less often as time passes. You can refresh manually; access still expires at the original two-hour deadline.</p>
              </>
            ) : (
              <button className="primary-button" type="button" onClick={() => show("productionCloseout")} disabled={busy}>I am production and have the device</button>
            )}
            {failure && <p className="error-summary" role="alert">{failure}</p>}
          </section>
        ) : screen === "productionCloseout" ? (
          <section className="panel" aria-labelledby="production-closeout-heading">
            <p className="eyebrow">Production closeout</p>
            <h1 id="production-closeout-heading">Choose the final test action.</h1>
            <button className="secondary-button" type="button" disabled={busy} onClick={refreshReleaseStatus}>Refresh delivery status</button>
            <p className="lede">Production may download the browser-held copy, retry an eligible failed delivery, or close the release. Closing immediately deletes SealProof's temporary PDF and personal information; emailed copies remain with Resend and their recipients.</p>
            {releaseStatus?.releaseState === "DELIVERY_FAILED" && (
              <div className="preview-actions">
                {releaseStatus.productionDeliveryOutcome === "FAILED" && releaseStatus.productionRetriesRemaining > 0 && (
                  <>
                    <button className="secondary-button" type="button" disabled={busy} onClick={() => retryLocalDelivery("PRODUCTION")}>Retry production delivery</button>
                    <p className="privacy-note">Production: {retryCountLabel(releaseStatus.productionRetriesRemaining)}.</p>
                  </>
                )}
                {releaseStatus.signerDeliveryOutcome === "FAILED" && releaseStatus.signerRetriesRemaining > 0 && (
                  <>
                    <button className="secondary-button" type="button" disabled={busy} onClick={() => retryLocalDelivery("SIGNER")}>Retry signer delivery</button>
                    <p className="privacy-note">Signer: {retryCountLabel(releaseStatus.signerRetriesRemaining)}.</p>
                  </>
                )}
                {releaseStatus.productionDeliveryOutcome === "FAILED" && releaseStatus.productionRetriesRemaining === 0 && (
                  <p className="privacy-note">Production: {retryCountLabel(0)}. Download if needed, then close the release.</p>
                )}
                {releaseStatus.signerDeliveryOutcome === "FAILED" && releaseStatus.signerRetriesRemaining === 0 && (
                  <p className="privacy-note">Signer: {retryCountLabel(0)}. Download if needed, then close the release.</p>
                )}
              </div>
            )}
            <div className="preview-actions">
              {finalPdfUrl && finalPdfBytes && (
                <a className="secondary-button" href={finalPdfUrl} download="sealproof-sealed-test.pdf">Download browser copy</a>
              )}
              <button className="primary-button" type="button" onClick={closeLocalRelease} disabled={busy}>
                {busy ? "Deleting SealProof storage…" : "Delete SealProof copy and close release"}
              </button>
            </div>
            {failure && <p className="error-summary" role="alert">{failure}</p>}
          </section>
        ) : (
          <section className="panel" aria-labelledby="complete-heading">
            <p className="eyebrow">{localRuntime ? "Local evidence complete" : "SealProof closeout complete"}</p>
            <h1 id="complete-heading">{localRuntime ? "Local Worker storage was deleted." : "SealProof's temporary copy was deleted."}</h1>
            <p className="lede">{localRuntime ? "SealProof confirmed removal of the encrypted Worker copy and temporary local database state. Nothing was emailed or sent to a live service." : "SealProof confirmed removal of its encrypted PDF, temporary personal information, delivery-attempt details, and webhook receipts. Recipient mailboxes and Resend retain their own delivered copies independently."}</p>
            <div className="handoff-card">
              <p><strong>Local SHA-256:</strong> <code className="inline-hash">{finalPdfHash}</code></p>
              <p><strong>This is still a test:</strong> {localRuntime ? "no contract was delivered and no live service received its contents." : "use the received messages only as controlled technical-test evidence."}</p>
              <p><strong>Privacy:</strong> use the button below to clear the remaining PDF and source inputs from this browser page.</p>
            </div>
            <button className="secondary-button" type="button" onClick={clearLocalTest}>End test and clear inputs</button>
          </section>
        )}
      </main>
    </div>
  );
}

interface FieldProps {
  children: React.ReactNode;
  error?: string;
  hint?: string;
  id: string;
  label: string;
  required?: boolean;
}

function Field({ children, error, hint, id, label, required }: FieldProps) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}{required && <span aria-hidden="true"> *</span>}</label>
      {hint && <p className="hint" id={`${id}-hint`}>{hint}</p>}
      {children}
      {error && <p className="field-error" id={`${id}-error`} role="alert">{error}</p>}
    </div>
  );
}
