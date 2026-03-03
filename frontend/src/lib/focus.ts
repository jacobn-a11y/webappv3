/**
 * Focus management utilities for modal dialogs and overlays.
 */

export const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/**
 * Trap focus within a dialog container.
 *
 * Handles Tab / Shift+Tab cycling and Escape to close.
 * Attach as a `keydown` listener on `document` while the dialog is open.
 */
export function trapDialogFocus(
  event: KeyboardEvent,
  container: HTMLElement,
  onClose?: () => void,
): void {
  if (event.key === "Escape") {
    onClose?.();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((el) => !el.hasAttribute("disabled"));
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) return;
  const active = document.activeElement as HTMLElement | null;
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
    return;
  }
  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}
