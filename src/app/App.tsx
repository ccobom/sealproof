import { FormEvent, useEffect, useState } from "react";
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

type Screen = "setup" | "preview" | "handoff" | "signer" | "photo" | "signature" | "localComplete";

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
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

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

  function beginHandoff() {
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

  function completeSignatureStep() {
    try {
      if (!signature) throw new Error("missing");
      validateSignature(signature);
      setSignatureError(undefined);
      show("localComplete");
    } catch {
      setSignatureError("Draw a signature before continuing.");
    }
  }

  function clearLocalTest() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(undefined);
    setPreviewBytes(undefined);
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
        <span className="build-label">local build</span>
      </header>

      <div className="test-banner" role="note">
        Test mode: no contract will be sealed, uploaded, stored, or emailed.
      </div>

      <main>
        <ol className="progress" aria-label="Current progress">
          <li aria-current={screen === "setup" ? "step" : undefined} className={progressStage >= 0 ? "complete" : ""}>Production details</li>
          <li aria-current={screen === "preview" ? "step" : undefined} className={progressStage >= 1 ? "complete" : ""}>Setup preview</li>
          <li aria-current={["handoff", "signer"].includes(screen) ? "step" : undefined} className={progressStage >= 2 ? "complete" : ""}>Signer review</li>
          <li aria-current={["photo", "signature", "localComplete"].includes(screen) ? "step" : undefined} className={progressStage >= 3 ? "complete" : ""}>Photo &amp; signature</li>
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
              <button className="primary-button" type="button" onClick={beginHandoff}>Approve setup and hand off</button>
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
            <button className="primary-button" type="button" onClick={completeSignatureStep}>Approve signature and continue</button>
          </section>
        ) : (
          <section className="panel" aria-labelledby="complete-heading">
            <p className="eyebrow">Local evidence complete</p>
            <h1 id="complete-heading">Your test details, signature{signerPhoto ? ", and photo" : ""} are held locally.</h1>
            <p className="lede">Nothing was uploaded, stored, emailed, or sealed. Your information, vector signature{signerPhoto ? ", and processed photo" : ""} exists only in this open browser page.</p>
            <div className="handoff-card">
              <p><strong>This is still a local test:</strong> completing these inputs did not create a contract.</p>
              <p><strong>Next build:</strong> add the reviewed details, photo or waiver, and signature to a new final PDF for exact review before sealing.</p>
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
