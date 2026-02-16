/**
 * Landing Page Editor
 *
 * Full-featured editor page with:
 *   - Sticky top bar with page title, status badge, Save Draft and Publish buttons
 *   - Textarea editor for markdown content
 *   - Publish modal with visibility, password, expiration, company name toggle,
 *     side-by-side scrub preview, and shareable URL on success
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "react-router-dom";
import {
  getEditorPageData,
  savePageDraft,
  getPreviewScrub,
  publishPage,
  type EditorPageData,
} from "../lib/api";

// ─── Main Component ──────────────────────────────────────────────────────────

export function LandingPageEditorPage() {
  const { pageId } = useParams<{ pageId: string }>();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageData, setPageData] = useState<EditorPageData | null>(null);
  const [body, setBody] = useState("");
  const [status, setStatus] = useState("DRAFT");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Publish modal state
  const [showPublishModal, setShowPublishModal] = useState(false);

  // Load editor data
  useEffect(() => {
    if (!pageId) return;
    setLoading(true);
    setError(null);

    getEditorPageData(pageId)
      .then((data) => {
        setPageData(data);
        setBody(data.editableBody);
        setStatus(data.status);
      })
      .catch((err) => {
        setError(err.message || "Failed to load page data");
      })
      .finally(() => setLoading(false));
  }, [pageId]);

  // Save draft
  const handleSaveDraft = useCallback(async () => {
    if (!pageId) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      await savePageDraft(pageId, body);
      setSaveMessage("Draft saved");
      setTimeout(() => setSaveMessage(null), 2000);
    } catch (err) {
      setSaveMessage("Save failed");
      setTimeout(() => setSaveMessage(null), 3000);
    } finally {
      setSaving(false);
    }
  }, [pageId, body]);

  // Handle successful publish
  const handlePublished = useCallback((url: string) => {
    setStatus("PUBLISHED");
  }, []);

  if (!pageId) {
    return (
      <div className="page-editor__error">No page ID provided.</div>
    );
  }

  if (loading) {
    return (
      <div className="page-editor__loading">
        <div className="page-editor__spinner" />
        <span>Loading editor...</span>
      </div>
    );
  }

  if (error || !pageData) {
    return (
      <div className="page-editor__error">
        <h2>Failed to load page</h2>
        <p>{error || "Page not found"}</p>
      </div>
    );
  }

  return (
    <div className="page-editor">
      {/* ─── Sticky Top Bar ─────────────────────────────────────────── */}
      <div className="page-editor__topbar">
        <div className="page-editor__topbar-left">
          <span className="page-editor__title">{pageData.title}</span>
          <span
            className={`page-editor__status page-editor__status--${status.toLowerCase()}`}
          >
            {status}
          </span>
        </div>
        <div className="page-editor__topbar-right">
          {saveMessage && (
            <span className="page-editor__save-message">{saveMessage}</span>
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
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              width="16"
              height="16"
            >
              <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
              <polyline points="16,6 12,2 8,6" />
              <line x1="12" y1="2" x2="12" y2="15" />
            </svg>
            Publish
          </button>
        </div>
      </div>

      {/* ─── Editor Area ────────────────────────────────────────────── */}
      <div className="page-editor__area">
        <textarea
          className="page-editor__textarea"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write your landing page content in markdown..."
        />
      </div>

      {/* ─── Publish Modal ──────────────────────────────────────────── */}
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
    </div>
  );
}

// ─── Publish Modal ───────────────────────────────────────────────────────────

interface PublishModalProps {
  pageId: string;
  initialVisibility: string;
  initialIncludeCompanyName: boolean;
  canPublishNamed: boolean;
  onClose: () => void;
  onPublished: (url: string) => void;
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
  const [includeCompanyName, setIncludeCompanyName] = useState(
    initialIncludeCompanyName
  );

  // Preview state
  const [previewLoading, setPreviewLoading] = useState(true);
  const [originalBody, setOriginalBody] = useState("");
  const [scrubbedBody, setScrubbedBody] = useState("");
  const [replacementCount, setReplacementCount] = useState(0);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Publish state
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState(false);

  const overlayRef = useRef<HTMLDivElement>(null);

  // Load scrub preview
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

  // Load preview on mount
  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  // Close on Escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  // Close on overlay click
  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === overlayRef.current) onClose();
  };

  // Submit publish
  const handlePublish = async () => {
    setPublishError(null);

    // Validate password
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
    } = { visibility };

    if (password) publishBody.password = password;
    if (expirationDate) {
      publishBody.expires_at = new Date(expirationDate).toISOString();
    }
    if (canPublishNamed) {
      publishBody.include_company_name = includeCompanyName;
    }

    try {
      const result = await publishPage(pageId, publishBody);
      setPublishedUrl(result.url);
      onPublished(result.url);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Publish failed. Please try again.";
      setPublishError(message);
    } finally {
      setPublishing(false);
    }
  };

  // Copy URL
  const handleCopyUrl = async () => {
    if (!publishedUrl) return;
    try {
      await navigator.clipboard.writeText(publishedUrl);
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    } catch {
      // fallback: select the input
    }
  };

  // Handle company name toggle
  const handleCompanyNameToggle = () => {
    setIncludeCompanyName(!includeCompanyName);
    // Reload preview when toggling
    loadPreview();
  };

  const truncatePreview = (text: string, maxLen: number): string => {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen) + "\n\n... (truncated)";
  };

  const isSuccessState = publishedUrl !== null;

  return (
    <div
      className="page-editor__modal-overlay"
      ref={overlayRef}
      onClick={handleOverlayClick}
    >
      <div
        className="page-editor__modal"
        role="dialog"
        aria-labelledby="publishModalTitle"
      >
        {/* Modal Header */}
        <div className="page-editor__modal-header">
          <h2 id="publishModalTitle">Publish Landing Page</h2>
          <button
            type="button"
            className="page-editor__modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              width="20"
              height="20"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Modal Body */}
        {!isSuccessState ? (
          <div className="page-editor__modal-body">
            {/* Settings Grid */}
            <div className="page-editor__publish-settings">
              {/* Visibility Toggle */}
              <div className="page-editor__field">
                <label className="page-editor__field-label">Visibility</label>
                <div className="page-editor__toggle-group">
                  <button
                    type="button"
                    className={`page-editor__toggle-option ${
                      visibility === "PRIVATE"
                        ? "page-editor__toggle-option--active"
                        : ""
                    }`}
                    onClick={() => setVisibility("PRIVATE")}
                  >
                    Private
                  </button>
                  <button
                    type="button"
                    className={`page-editor__toggle-option ${
                      visibility === "SHARED_WITH_LINK"
                        ? "page-editor__toggle-option--active"
                        : ""
                    }`}
                    onClick={() => setVisibility("SHARED_WITH_LINK")}
                  >
                    Shared with Link
                  </button>
                </div>
                <span className="page-editor__field-hint">
                  Private pages are only visible to your team.
                </span>
              </div>

              {/* Password */}
              <div className="page-editor__field">
                <label className="page-editor__field-label">
                  Password Protection
                </label>
                <input
                  type="password"
                  className="page-editor__text-input"
                  placeholder="Leave empty for no password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={4}
                  maxLength={100}
                />
                <span className="page-editor__field-hint">
                  Optional. Must be 4+ characters if set.
                </span>
              </div>

              {/* Expiration Date */}
              <div className="page-editor__field">
                <label className="page-editor__field-label">
                  Expiration Date
                </label>
                <input
                  type="datetime-local"
                  className="page-editor__text-input"
                  value={expirationDate}
                  onChange={(e) => setExpirationDate(e.target.value)}
                />
                <span className="page-editor__field-hint">
                  Optional. Link stops working after this date.
                </span>
              </div>

              {/* Include Company Name */}
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
                      <div className="page-editor__toggle-row-label">
                        Include company name
                      </div>
                      <div className="page-editor__toggle-row-desc">
                        Show the real company name instead of anonymizing it.
                        Only use this with client permission.
                      </div>
                    </div>
                  </div>
                  {includeCompanyName && (
                    <div className="page-editor__warning-banner">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        width="14"
                        height="14"
                      >
                        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                        <line x1="12" y1="9" x2="12" y2="13" />
                        <line x1="12" y1="17" x2="12.01" y2="17" />
                      </svg>
                      The real company name will be visible to anyone who views
                      this page. Make sure you have permission from the client
                      before enabling this.
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Scrub Preview */}
            <div className="page-editor__preview-section">
              <div className="page-editor__preview-header">
                <span className="page-editor__preview-title">
                  Scrub Preview
                </span>
                {!previewLoading && !previewError && (
                  <span className="page-editor__preview-badge">
                    {replacementCount} replacement
                    {replacementCount !== 1 ? "s" : ""}
                  </span>
                )}
              </div>

              <div className="page-editor__preview-panels">
                {previewLoading ? (
                  <div className="page-editor__preview-loading">
                    <div className="page-editor__spinner page-editor__spinner--sm" />
                    Loading preview...
                  </div>
                ) : previewError ? (
                  <div className="page-editor__preview-loading">
                    {previewError}
                  </div>
                ) : (
                  <>
                    <div className="page-editor__preview-panel">
                      <div className="page-editor__preview-panel-heading">
                        Original
                      </div>
                      <div className="page-editor__preview-panel-content">
                        {truncatePreview(originalBody, 3000)}
                      </div>
                    </div>
                    <div className="page-editor__preview-panel page-editor__preview-panel--scrubbed">
                      <div className="page-editor__preview-panel-heading">
                        Scrubbed (Published Version)
                      </div>
                      <div className="page-editor__preview-panel-content">
                        {truncatePreview(scrubbedBody, 3000)}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Publish Error */}
            {publishError && (
              <div className="page-editor__publish-error">{publishError}</div>
            )}
          </div>
        ) : (
          /* Success State */
          <div className="page-editor__publish-success">
            <div className="page-editor__success-icon">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                width="28"
                height="28"
              >
                <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                <polyline points="22,4 12,14.01 9,11.01" />
              </svg>
            </div>
            <h3>Published!</h3>
            <p>Your landing page is live. Share the URL below.</p>
            <div className="page-editor__url-copy-group">
              <input
                type="text"
                className="page-editor__url-input"
                value={publishedUrl}
                readOnly
              />
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

        {/* Modal Footer */}
        {!isSuccessState && (
          <div className="page-editor__modal-footer">
            <div className="page-editor__modal-footer-left">
              Review the scrub preview before publishing.
            </div>
            <div className="page-editor__modal-footer-right">
              <button
                type="button"
                className="page-editor__btn page-editor__btn--secondary"
                onClick={onClose}
              >
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
