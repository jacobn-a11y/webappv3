/**
 * Landing Page Editor
 *
 * Full-featured editor page with:
 *   - Sticky top bar with page title, status badge, Save Draft and Publish buttons
 *   - Textarea editor for markdown content
 *   - Publish modal with visibility, password, expiration, company name toggle,
 *     release notes, side-by-side scrub preview, and shareable URL on success
 *   - Published version history with rollback controls
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import {
  getEditorPageData,
  getPageVersions,
  rollbackPageVersion,
  savePageDraft,
  getPreviewScrub,
  publishPage,
  type ArtifactVersion,
  type EditorPageData,
} from "../lib/api";

// ─── Inline Confirm Dialog ──────────────────────────────────────────────────

interface InlineConfirmProps {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function InlineConfirmDialog({
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
      if (e.key === "Escape") {
        onCancel();
        return;
      }
      if (e.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
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

// --- Main Component ----------------------------------------------------------

export function LandingPageEditorPage() {
  const { pageId } = useParams<{ pageId: string }>();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageData, setPageData] = useState<EditorPageData | null>(null);
  const [body, setBody] = useState("");
  const [status, setStatus] = useState("DRAFT");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const [versions, setVersions] = useState<ArtifactVersion[]>([]);
  const [versionLoading, setVersionLoading] = useState(false);
  const [versionError, setVersionError] = useState<string | null>(null);

  const [showPublishModal, setShowPublishModal] = useState(false);
  const [rollbackVersionId, setRollbackVersionId] = useState<string | null>(null);

  const loadPage = useCallback(async () => {
    if (!pageId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getEditorPageData(pageId);
      setPageData(data);
      setBody(data.editableBody);
      setStatus(data.status);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load page data");
    } finally {
      setLoading(false);
    }
  }, [pageId]);

  const loadVersions = useCallback(async () => {
    if (!pageId) return;
    setVersionLoading(true);
    setVersionError(null);
    try {
      const res = await getPageVersions(pageId);
      setVersions(res.versions);
    } catch (err) {
      setVersionError(err instanceof Error ? err.message : "Failed to load versions");
    } finally {
      setVersionLoading(false);
    }
  }, [pageId]);

  useEffect(() => {
    loadPage();
  }, [loadPage]);

  useEffect(() => {
    loadVersions();
  }, [loadVersions]);

  // Track whether content has unsaved changes
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSaveDraft = useCallback(async () => {
    if (!pageId) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      await savePageDraft(pageId, body);
      setSaveMessage("Draft saved");
      setHasUnsavedChanges(false);
      setLastSavedAt(new Date());
      setTimeout(() => setSaveMessage(null), 2000);
    } catch {
      setSaveMessage("Save failed");
      setTimeout(() => setSaveMessage(null), 3000);
    } finally {
      setSaving(false);
    }
  }, [pageId, body]);

  // Autosave after 30s of inactivity
  const handleBodyChange = useCallback((newBody: string) => {
    setBody(newBody);
    setHasUnsavedChanges(true);
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      if (pageId && newBody) {
        savePageDraft(pageId, newBody)
          .then(() => {
            setSaveMessage("Autosaved");
            setHasUnsavedChanges(false);
            setLastSavedAt(new Date());
            setTimeout(() => setSaveMessage(null), 2000);
          })
          .catch(() => {});
      }
    }, 30000);
  }, [pageId]);

  // Cleanup autosave timer
  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, []);

  const handlePublished = useCallback(() => {
    setStatus("PUBLISHED");
    loadVersions();
  }, [loadVersions]);

  const handleRollbackVersion = useCallback(
    (versionId: string) => {
      setRollbackVersionId(versionId);
    },
    []
  );

  const executeRollback = useCallback(async () => {
    if (!pageId || !rollbackVersionId) return;
    setRollbackVersionId(null);
    try {
      await rollbackPageVersion(pageId, rollbackVersionId);
      setSaveMessage("Rolled back to selected version");
      setTimeout(() => setSaveMessage(null), 3000);
      await Promise.all([loadPage(), loadVersions()]);
    } catch (err) {
      setVersionError(err instanceof Error ? err.message : "Rollback failed");
    }
  }, [pageId, rollbackVersionId, loadPage, loadVersions]);

  if (!pageId) {
    return <div className="page-editor__error">No page ID provided.</div>;
  }

  if (loading) {
    return (
      <div className="page-editor__loading" role="status" aria-live="polite">
        <div className="page-editor__spinner" aria-hidden="true" />
        <span>Loading editor...</span>
      </div>
    );
  }

  if (error || !pageData) {
    return (
      <div className="page-editor__error" role="alert">
        <h2>Failed to load page</h2>
        <p>{error || "Page not found"}</p>
      </div>
    );
  }

  return (
    <div className="page-editor">
      {/* Breadcrumb */}
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link to="/dashboard/pages">Pages</Link>
        <span className="breadcrumbs__separator" aria-hidden="true">/</span>
        <span className="breadcrumbs__current">{pageData.title}</span>
      </nav>

      <div className="page-editor__topbar">
        <div className="page-editor__topbar-left">
          <span className="page-editor__title">{pageData.title}</span>
          <span className={`page-editor__status page-editor__status--${status.toLowerCase()}`}>
            {status}
          </span>
          {hasUnsavedChanges && (
            <span className="page-editor__unsaved-dot" title="Unsaved changes" aria-label="Unsaved changes">
              <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true"><circle cx="4" cy="4" r="4" fill="var(--color-warning)" /></svg>
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
            onClick={handleSaveDraft}
            disabled={saving}
          >
            {saving ? "Saving..." : "Save Draft"}
          </button>
          <button
            type="button"
            className="page-editor__btn page-editor__btn--primary"
            onClick={() => setShowPublishModal(true)}
          >
            Publish
          </button>
        </div>
      </div>

      <div className="page-editor__area">
        <textarea
          className="page-editor__textarea"
          value={body}
          onChange={(e) => handleBodyChange(e.target.value)}
          placeholder="Write your landing page content in markdown..."
          aria-label="Page content editor"
        />
      </div>

      <div className="page-editor__versions">
        <div className="page-editor__versions-header">
          <h3>Published Versions</h3>
          <button
            type="button"
            className="page-editor__btn page-editor__btn--secondary"
            onClick={loadVersions}
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
            {versions.map((v) => (
              <div key={v.id} className="page-editor__version-row">
                <div>
                  <strong>v{v.version_number}</strong> · {v.status}
                  <div className="page-editor__version-meta">
                    {new Date(v.created_at).toLocaleString()}
                    {v.release_notes ? ` · ${v.release_notes}` : ""}
                  </div>
                </div>
                <button
                  type="button"
                  className="page-editor__btn page-editor__btn--secondary"
                  onClick={() => handleRollbackVersion(v.id)}
                  disabled={v.status === "ROLLED_BACK"}
                >
                  Rollback
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {showPublishModal && (
        <PublishModal
          pageId={pageId}
          initialVisibility={pageData.visibility}
          initialIncludeCompanyName={pageData.includeCompanyName}
          canPublishNamed={pageData.canPublishNamed}
          onClose={() => setShowPublishModal(false)}
          onPublished={handlePublished}
        />
      )}

      {rollbackVersionId && (
        <InlineConfirmDialog
          title="Rollback Version"
          message="Rollback to this version? The current published revision will be replaced."
          confirmLabel="Rollback"
          onConfirm={executeRollback}
          onCancel={() => setRollbackVersionId(null)}
        />
      )}
    </div>
  );
}

// --- Publish Modal ----------------------------------------------------------

interface PublishModalProps {
  pageId: string;
  initialVisibility: string;
  initialIncludeCompanyName: boolean;
  canPublishNamed: boolean;
  onClose: () => void;
  onPublished: () => void;
}

function PublishModal({
  pageId,
  initialVisibility,
  initialIncludeCompanyName,
  canPublishNamed,
  onClose,
  onPublished,
}: PublishModalProps) {
  const [visibility, setVisibility] = useState(initialVisibility || "PRIVATE");
  const [password, setPassword] = useState("");
  const [expirationDate, setExpirationDate] = useState("");
  const [releaseNotes, setReleaseNotes] = useState("");
  const [includeCompanyName, setIncludeCompanyName] = useState(initialIncludeCompanyName);

  const [previewLoading, setPreviewLoading] = useState(true);
  const [originalBody, setOriginalBody] = useState("");
  const [scrubbedBody, setScrubbedBody] = useState("");
  const [replacementCount, setReplacementCount] = useState(0);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState(false);

  const overlayRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const loadPreview = useCallback(async () => {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const data = await getPreviewScrub(pageId);
      setOriginalBody(data.original.body || "");
      setScrubbedBody(data.scrubbed.body || "");
      setReplacementCount(data.replacements_made || 0);
    } catch {
      setPreviewError("Failed to load preview. Try again.");
    } finally {
      setPreviewLoading(false);
    }
  }, [pageId]);

  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  // Focus management: capture focus, trap Tab, Escape to close
  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "Tab" && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    // Focus the modal on open
    requestAnimationFrame(() => {
      modalRef.current?.focus();
    });

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [onClose]);

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === overlayRef.current) onClose();
  };

  const handlePublish = async () => {
    setPublishError(null);

    if (password && password.length < 4) {
      setPublishError("Password must be at least 4 characters.");
      return;
    }

    setPublishing(true);

    const publishBody: {
      visibility: string;
      password?: string;
      expires_at?: string;
      include_company_name?: boolean;
      release_notes?: string;
    } = { visibility };

    if (password) publishBody.password = password;
    if (expirationDate) publishBody.expires_at = new Date(expirationDate).toISOString();
    if (releaseNotes.trim()) publishBody.release_notes = releaseNotes.trim();
    if (canPublishNamed) publishBody.include_company_name = includeCompanyName;

    try {
      const result = await publishPage(pageId, publishBody);
      if (result.queued_for_approval) {
        setPublishError(
          `Publish queued for approval${result.request_id ? ` (request ${result.request_id})` : ""}.`
        );
        onPublished();
        return;
      }
      setPublishedUrl(result.url ?? null);
      onPublished();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Publish failed. Please try again.";
      setPublishError(message);
    } finally {
      setPublishing(false);
    }
  };

  const handleCopyUrl = async () => {
    if (!publishedUrl) return;
    try {
      await navigator.clipboard.writeText(publishedUrl);
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    } catch {
      // no-op fallback
    }
  };

  const handleCompanyNameToggle = () => {
    setIncludeCompanyName(!includeCompanyName);
    loadPreview();
  };

  const truncatePreview = (text: string, maxLen: number): string => {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen) + "\n\n... (truncated)";
  };

  const isSuccessState = publishedUrl !== null;

  return (
    <div className="page-editor__modal-overlay" ref={overlayRef} onClick={handleOverlayClick}>
      <div className="page-editor__modal" ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="publishModalTitle" tabIndex={-1}>
        <div className="page-editor__modal-header">
          <h2 id="publishModalTitle">Publish Landing Page</h2>
          <button type="button" className="page-editor__modal-close" onClick={onClose} aria-label="Close">
            x
          </button>
        </div>

        {!isSuccessState ? (
          <div className="page-editor__modal-body">
            <div className="page-editor__publish-settings">
              <div className="page-editor__field">
                <label className="page-editor__field-label">Visibility</label>
                <div className="page-editor__toggle-group">
                  <button
                    type="button"
                    className={`page-editor__toggle-option ${visibility === "PRIVATE" ? "page-editor__toggle-option--active" : ""}`}
                    onClick={() => setVisibility("PRIVATE")}
                  >
                    Private
                  </button>
                  <button
                    type="button"
                    className={`page-editor__toggle-option ${visibility === "SHARED_WITH_LINK" ? "page-editor__toggle-option--active" : ""}`}
                    onClick={() => setVisibility("SHARED_WITH_LINK")}
                  >
                    Shared with Link
                  </button>
                </div>
              </div>

              <div className="page-editor__field">
                <label className="page-editor__field-label" htmlFor="publish-password">Password Protection</label>
                <input
                  id="publish-password"
                  type="password"
                  className="page-editor__text-input"
                  placeholder="Leave empty for no password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={4}
                  maxLength={100}
                />
              </div>

              <div className="page-editor__field">
                <label className="page-editor__field-label" htmlFor="publish-expiration">Expiration Date</label>
                <input
                  id="publish-expiration"
                  type="datetime-local"
                  className="page-editor__text-input"
                  value={expirationDate}
                  onChange={(e) => setExpirationDate(e.target.value)}
                />
              </div>

              <div className="page-editor__field page-editor__field--full">
                <label className="page-editor__field-label" htmlFor="publish-release-notes">Release Notes</label>
                <textarea
                  id="publish-release-notes"
                  className="page-editor__text-input"
                  value={releaseNotes}
                  onChange={(e) => setReleaseNotes(e.target.value)}
                  maxLength={1000}
                  rows={3}
                  placeholder="Describe what changed in this publish..."
                />
              </div>

              {canPublishNamed && (
                <div className="page-editor__field page-editor__field--full">
                  <div className="page-editor__toggle-row">
                    <input
                      type="checkbox"
                      id="includeCompanyName"
                      checked={includeCompanyName}
                      onChange={handleCompanyNameToggle}
                    />
                    <div>
                      <div className="page-editor__toggle-row-label">Include company name</div>
                      <div className="page-editor__toggle-row-desc">
                        Show the real company name instead of anonymizing it.
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="page-editor__preview-section">
              <div className="page-editor__preview-header">
                <span className="page-editor__preview-title">Scrub Preview</span>
                {!previewLoading && !previewError && (
                  <span className="page-editor__preview-badge">
                    {replacementCount} replacement{replacementCount !== 1 ? "s" : ""}
                  </span>
                )}
              </div>

              <div className="page-editor__preview-panels">
                {previewLoading ? (
                  <div className="page-editor__preview-loading">Loading preview...</div>
                ) : previewError ? (
                  <div className="page-editor__preview-loading">{previewError}</div>
                ) : (
                  <>
                    <div className="page-editor__preview-panel">
                      <div className="page-editor__preview-panel-heading">Original</div>
                      <div className="page-editor__preview-panel-content">{truncatePreview(originalBody, 3000)}</div>
                    </div>
                    <div className="page-editor__preview-panel page-editor__preview-panel--scrubbed">
                      <div className="page-editor__preview-panel-heading">Scrubbed (Published Version)</div>
                      <div className="page-editor__preview-panel-content">{truncatePreview(scrubbedBody, 3000)}</div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {publishError && <div className="page-editor__publish-error">{publishError}</div>}
          </div>
        ) : (
          <div className="page-editor__publish-success">
            <h3>Published!</h3>
            <p>Your landing page is live. Share the URL below.</p>
            <div className="page-editor__url-copy-group">
              <input type="text" className="page-editor__url-input" value={publishedUrl} readOnly />
              <button
                type="button"
                className="page-editor__btn page-editor__btn--primary page-editor__btn--sm"
                onClick={handleCopyUrl}
              >
                {copyFeedback ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
        )}

        {!isSuccessState && (
          <div className="page-editor__modal-footer">
            <div className="page-editor__modal-footer-left">Review the scrub preview before publishing.</div>
            <div className="page-editor__modal-footer-right">
              <button type="button" className="page-editor__btn page-editor__btn--secondary" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="page-editor__btn page-editor__btn--primary"
                onClick={handlePublish}
                disabled={publishing || previewLoading}
              >
                {publishing ? "Publishing..." : "Publish Page"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
