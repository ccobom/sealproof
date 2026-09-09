import { FormEvent, useEffect, useState } from "react";
import {
  productionSetupSchema,
  SYNTHETIC_RELEASE_TEXT,
  todayForDateInput,
  type ProductionSetup,
} from "./production-setup";

type Screen = "setup" | "preview";

const INITIAL_SETUP: ProductionSetup = {
  productionName: "",
  signatureCollector: "",
  productionEmail: "",
  projectTitle: "",
  agreementDate: todayForDateInput(),
};

export function App() {
  const [screen, setScreen] = useState<Screen>("setup");
  const [setup, setSetup] = useState(INITIAL_SETUP);
  const [errors, setErrors] = useState<Record<string, string>>({});
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
          <li aria-current={screen === "setup" ? "step" : undefined} className="complete">Production details</li>
          <li aria-current={screen === "preview" ? "step" : undefined} className={screen === "preview" ? "complete" : ""}>Exact preview</li>
          <li>Signer handoff</li>
          <li>Seal &amp; deliver</li>
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
        ) : (
          <section className="panel preview-panel" aria-labelledby="preview-heading">
            <p className="eyebrow">Step 2 of 2 in this build</p>
            <h1 id="preview-heading">Review the exact document</h1>
            <p className="lede">These are the exact PDF bytes generated in your browser. Nothing has left this device.</p>
            {previewUrl && <iframe className="pdf-preview" src={previewUrl} title="Generated test release PDF" />}
            <div className="preview-actions">
              <button className="secondary-button" type="button" onClick={editSetup}>Edit production details</button>
              {previewUrl && previewBytes && (
                <a className="primary-button" href={previewUrl} download="sealproof-test-preview.pdf">Download test PDF</a>
              )}
            </div>
            <p className="next-note"><strong>Next build:</strong> signer handoff, identity details, photo, and signature.</p>
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
