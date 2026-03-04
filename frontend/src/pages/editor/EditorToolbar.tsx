export interface EditorToolbarProps {
  title: string;
  status: string;
  hasUnsavedChanges: boolean;
  saving: boolean;
  saveMessage: string | null;
  lastSavedAt: Date | null;
  onSaveDraft: () => void;
  onPublish: () => void;
}

export function EditorToolbar({
  title,
  status,
  hasUnsavedChanges,
  saving,
  saveMessage,
  lastSavedAt,
  onSaveDraft,
  onPublish,
}: EditorToolbarProps) {
  return (
    <div className="page-editor__topbar">
      <div className="page-editor__topbar-left">
        <span className="page-editor__title">{title}</span>
        <span className={`page-editor__status page-editor__status--${status.toLowerCase()}`}>
          {status}
        </span>
        {hasUnsavedChanges && (
          <span className="page-editor__unsaved-dot" title="Unsaved changes" aria-label="Unsaved changes">
            <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
              <circle cx="4" cy="4" r="4" fill="var(--color-warning)" />
            </svg>
          </span>
        )}
      </div>
      <div className="page-editor__topbar-right">
        {saveMessage && <span className="page-editor__save-message">{saveMessage}</span>}
        {!saveMessage && lastSavedAt && !hasUnsavedChanges && (
          <span className="page-editor__save-message page-editor__save-message--muted">
            Saved {lastSavedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
        <button
          type="button"
          className="page-editor__btn page-editor__btn--secondary"
          onClick={onSaveDraft}
          disabled={saving}
        >
          {saving ? "Saving..." : "Save Draft"}
        </button>
        <button
          type="button"
          className="page-editor__btn page-editor__btn--primary"
          onClick={onPublish}
        >
          Publish
        </button>
      </div>
    </div>
  );
}
