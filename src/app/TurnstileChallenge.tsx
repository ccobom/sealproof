import { useEffect, useRef, useState } from "react";

interface TurnstileApi {
  render(container: HTMLElement, options: {
    sitekey: string;
    action: string;
    appearance: "always";
    theme: "light";
    callback(token: string): void;
    "expired-callback"(): void;
    "error-callback"(): void;
  }): string;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<TurnstileApi> | undefined;

function loadScript(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;
  const pending = new Promise<TurnstileApi>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-sealproof-turnstile]");
    const script = existing ?? document.createElement("script");
    const loaded = () => window.turnstile
      ? resolve(window.turnstile)
      : reject(new Error("Turnstile API unavailable"));
    script.addEventListener("load", loaded, { once: true });
    script.addEventListener("error", () => {
      script.remove();
      reject(new Error("Turnstile failed to load"));
    }, { once: true });
    if (!existing) {
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.dataset.sealproofTurnstile = "true";
      document.head.append(script);
    }
  });
  scriptPromise = pending;
  void pending.catch(() => {
    if (scriptPromise === pending) scriptPromise = undefined;
  });
  return pending;
}

interface TurnstileChallengeProps {
  siteKey: string;
  action: "release-finalization";
  resetVersion: number;
  onTokenChange(token: string | undefined): void;
}

export function TurnstileChallenge({
  siteKey,
  action,
  resetVersion,
  onTokenChange,
}: TurnstileChallengeProps) {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let widgetId: string | undefined;
    setFailed(false);
    onTokenChange(undefined);
    void loadScript().then((turnstile) => {
      if (!active || !container.current) return;
      widgetId = turnstile.render(container.current, {
        sitekey: siteKey,
        action,
        appearance: "always",
        theme: "light",
        callback: (token) => {
          if (active) onTokenChange(token);
        },
        "expired-callback": () => {
          if (active) onTokenChange(undefined);
        },
        "error-callback": () => {
          if (active) {
            onTokenChange(undefined);
            setFailed(true);
          }
        },
      });
    }).catch(() => {
      if (active) setFailed(true);
    });
    return () => {
      active = false;
      onTokenChange(undefined);
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [action, onTokenChange, resetVersion, siteKey]);

  return (
    <div className="turnstile-boundary" aria-label="Anti-abuse check">
      <p><strong>Privacy-preserving anti-abuse check</strong></p>
      <p className="privacy-note">Cloudflare Turnstile must finish before SealProof can accept this PDF. The challenge does not receive your form entries or document.</p>
      <div ref={container} />
      {failed && <p className="field-error" role="alert">The anti-abuse check could not complete. Check your connection or content blocker and try again.</p>}
    </div>
  );
}
