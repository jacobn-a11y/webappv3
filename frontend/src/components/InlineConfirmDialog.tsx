/**
 * Reusable inline confirmation dialog with focus trapping.
 *
 * Extracted from LandingPageEditorPage to be shared across
 * any feature that needs a confirmation overlay.
 */
import { useEffect, useRef } from "react";
import { trapDialogFocus } from "../lib/focus";

interface InlineConfirmDialogProps {
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
}: InlineConfirmDialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;
    cancelBtnRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (dialogRef.current) {
        trapDialogFocus(e, dialogRef.current, onCancel);
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
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
      >
        <div className="page-editor__modal-header">
          <h2 id="confirm-dialog-title">{title}</h2>
        </div>
        <div className="page-editor__modal-body">
          <p id="confirm-dialog-message">{message}</p>
        </div>
        <div className="page-editor__modal-footer">
          <div className="page-editor__modal-footer-right">
            <button
              ref={cancelBtnRef}
              type="button"
              className="page-editor__btn page-editor__btn--secondary"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              className="page-editor__btn page-editor__btn--primary"
              onClick={onConfirm}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
