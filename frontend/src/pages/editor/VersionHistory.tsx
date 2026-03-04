import { useEffect, useRef } from "react";
import { formatEnumLabel } from "../../lib/format";
import type { ArtifactVersion } from "../../lib/api";

// ─── Post-publish validation ─────────────────────────────────────────────────

interface PostPublishValidationSnapshot {
  status: "PASS" | "FAIL";
  checked_at: string;
  links_checked: number;
  broken_links: Array<{
    field: string;
    url: string;
    statusCode: number | null;
    reason: string;
  }>;
}

export function getPostPublishValidation(
  provenance: Record<string, unknown> | null
): PostPublishValidationSnapshot | null {
  if (!provenance || typeof provenance !== "object") return null;
  const raw = (provenance as { post_publish_validation?: unknown }).post_publish_validation;
  if (!raw || typeof raw !== "object") return null;
  const validation = raw as Partial<PostPublishValidationSnapshot>;
  if (
    (validation.status !== "PASS" && validation.status !== "FAIL") ||
    typeof validation.checked_at !== "string"
  )
    return null;
  return {
    status: validation.status,
    checked_at: validation.checked_at,
    links_checked: typeof validation.links_checked === "number" ? validation.links_checked : 0,
    broken_links: Array.isArray(validation.broken_links)
      ? (validation.broken_links as PostPublishValidationSnapshot["broken_links"])
      : [],
  };
}

// ─── Inline Confirm Dialog ──────────────────────────────────────────────────

interface InlineConfirmProps {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function InlineConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: InlineConfirmProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;
    cancelBtnRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onCancel(); return; }
      if (e.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled])');
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [onCancel]);

  return (
    <div
      className="page-editor__modal-overlay"
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onCancel(); }}
    >
      <div
        className="page-editor__modal"
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="rollback-confirm-title"
        aria-describedby="rollback-confirm-message"
      >
        <div className="page-editor__modal-header">
          <h2 id="rollback-confirm-title">{title}</h2>
        </div>
        <div className="page-editor__modal-body">
          <p id="rollback-confirm-message">{message}</p>
        </div>
        <div className="page-editor__modal-footer">
          <div className="page-editor__modal-footer-right">
            <button ref={cancelBtnRef} type="button" className="page-editor__btn page-editor__btn--secondary" onClick={onCancel}>Cancel</button>
            <button type="button" className="page-editor__btn page-editor__btn--primary" onClick={onConfirm}>{confirmLabel}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Version History ──────────────────────────────────────────────────────────

export interface VersionHistoryProps {
  versions: ArtifactVersion[];
  versionLoading: boolean;
  versionError: string | null;
  onRefresh: () => void;
  onRollback: (versionId: string) => void;
}

export function VersionHistory({
  versions,
  versionLoading,
  versionError,
  onRefresh,
  onRollback,
}: VersionHistoryProps) {
  return (
    <div className="page-editor__versions">
      <div className="page-editor__versions-header">
        <h3>Published Versions</h3>
        <button
          type="button"
          className="page-editor__btn page-editor__btn--secondary"
          onClick={onRefresh}
          disabled={versionLoading}
        >
          {versionLoading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {versionError && <div className="page-editor__publish-error">{versionError}</div>}

      {!versionLoading && versions.length === 0 ? (
        <div className="page-editor__version-empty">No published versions yet.</div>
      ) : (
        <div className="page-editor__version-list">
          {versions.map((v) => {
            const validation = getPostPublishValidation(v.provenance);
            return (
              <div key={v.id} className="page-editor__version-row">
                <div>
                  <strong>v{v.version_number}</strong> · {formatEnumLabel(v.status)}
                  <div className="page-editor__version-meta">
                    {new Date(v.created_at).toLocaleString()}
                    {v.release_notes ? ` · ${v.release_notes}` : ""}
                  </div>
                  {!validation ? (
                    <div className="page-editor__validation page-editor__validation--pending">
                      Validation pending
                    </div>
                  ) : (
                    <div
                      className={`page-editor__validation ${
                        validation.status === "PASS"
                          ? "page-editor__validation--pass"
                          : "page-editor__validation--fail"
                      }`}
                    >
                      Validation {validation.status === "PASS" ? "passed" : "failed"} ·{" "}
                      {validation.broken_links.length} broken link
                      {validation.broken_links.length === 1 ? "" : "s"} ·{" "}
                      {new Date(validation.checked_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className="page-editor__btn page-editor__btn--secondary"
                  onClick={() => onRollback(v.id)}
                  disabled={v.status === "ROLLED_BACK"}
                >
                  Rollback
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
