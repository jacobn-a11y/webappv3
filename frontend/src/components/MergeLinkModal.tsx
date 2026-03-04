import { useEffect, useMemo, useState } from "react";

type MergeLinkSuccessPayload = string | { public_token?: string } | null | undefined;

declare global {
  interface Window {
    MergeLink?: {
      initialize: (options: {
        linkToken: string;
        onSuccess: (payload: MergeLinkSuccessPayload) => void;
        onExit?: () => void;
        onReady?: () => void;
        onError?: (error: unknown) => void;
      }) => void;
      openLink: () => void;
    };
  }
}

let mergeScriptLoadPromise: Promise<void> | null = null;

function ensureMergeLinkScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Merge Link only runs in the browser"));
  }

  if (window.MergeLink) {
    return Promise.resolve();
  }

  if (!mergeScriptLoadPromise) {
    mergeScriptLoadPromise = new Promise<void>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>(
        'script[data-merge-link-script="true"]'
      );
      if (existing) {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener(
          "error",
          () => reject(new Error("Failed to load Merge Link SDK")),
          { once: true }
        );
        return;
      }

      const script = document.createElement("script");
      script.src = "https://cdn.merge.dev/initialize.js";
      script.async = true;
      script.defer = true;
      script.dataset.mergeLinkScript = "true";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load Merge Link SDK"));
      document.body.appendChild(script);
    });
  }

  return mergeScriptLoadPromise;
}

function extractPublicToken(payload: MergeLinkSuccessPayload): string | null {
  if (typeof payload === "string") return payload;
  if (payload && typeof payload === "object" && typeof payload.public_token === "string") {
    return payload.public_token;
  }
  return null;
}

interface MergeLinkModalProps {
  open: boolean;
  title: string;
  linkToken: string | null;
  onClose: () => void;
  onComplete: (publicToken: string) => Promise<void>;
}

export function MergeLinkModal({
  open,
  title,
  linkToken,
  onClose,
  onComplete,
}: MergeLinkModalProps) {
  const [sdkReady, setSdkReady] = useState(false);
  const [sdkError, setSdkError] = useState<string | null>(null);
  const [manualToken, setManualToken] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const canOpenMergeLink = useMemo(() => open && !!linkToken && sdkReady, [open, linkToken, sdkReady]);

  useEffect(() => {
    if (!open || !linkToken) return;

    let mounted = true;
    setSdkReady(false);
    setSdkError(null);

    ensureMergeLinkScript()
      .then(() => {
        if (!mounted) return;
        if (!window.MergeLink) {
          setSdkError("Merge Link SDK is not available in this browser.");
          return;
        }

        window.MergeLink.initialize({
          linkToken,
          onReady: () => {
            if (mounted) setSdkReady(true);
          },
          onExit: () => {
            if (mounted) onClose();
          },
          onError: () => {
            if (mounted) {
              setSdkError("Merge Link failed to initialize. You can complete manually below.");
            }
          },
          onSuccess: (payload) => {
            const publicToken = extractPublicToken(payload);
            if (!publicToken) {
              setSdkError("Merge returned an unexpected response. Paste public token manually.");
              return;
            }
            void handleComplete(publicToken);
          },
        });
      })
      .catch((error) => {
        if (mounted) {
          setSdkError(error instanceof Error ? error.message : "Failed to load Merge Link SDK.");
        }
      });

    return () => {
      mounted = false;
    };
  }, [open, linkToken, onClose]);

  const handleComplete = async (publicToken: string) => {
    setSubmitting(true);
    setSdkError(null);
    try {
      await onComplete(publicToken);
      setManualToken("");
      onClose();
    } catch (error) {
      setSdkError(error instanceof Error ? error.message : "Failed to complete integration link.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="modal modal--sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="merge-link-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="merge-link-title" className="modal__title">
          {title}
        </h3>
        <p className="modal__message">
          Launch Merge Link to connect your provider. If the popup is blocked, use the manual token fallback.
        </p>

        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          <button
            className="btn btn--primary"
            type="button"
            disabled={!canOpenMergeLink || submitting}
            onClick={() => window.MergeLink?.openLink()}
          >
            Open Merge Link
          </button>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-group__label" htmlFor="merge-public-token">
              Manual Public Token (fallback)
            </label>
            <input
              id="merge-public-token"
              className="form-input"
              value={manualToken}
              onChange={(event) => setManualToken(event.target.value)}
              placeholder="Paste Merge public_token"
              autoComplete="off"
            />
            <span className="form-group__hint">
              Use this only if your environment blocks the Merge popup flow.
            </span>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button className="btn btn--ghost" type="button" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button
              className="btn btn--secondary"
              type="button"
              disabled={submitting || manualToken.trim().length === 0}
              onClick={() => void handleComplete(manualToken.trim())}
            >
              {submitting ? "Connecting..." : "Complete Connection"}
            </button>
          </div>
        </div>

        {sdkError && (
          <p style={{ marginTop: 10, color: "var(--color-danger)" }}>
            {sdkError}
          </p>
        )}
      </div>
    </div>
  );
}
