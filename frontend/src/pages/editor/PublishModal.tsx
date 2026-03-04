import { useState, useEffect, useCallback, useRef } from "react";
import {
  getPreviewScrub,
  getScheduledPagePublish,
  publishPage,
  schedulePagePublish,
  cancelScheduledPagePublish,
} from "../../lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PublishModalProps {
  pageId: string;
  initialVisibility: string;
  initialIncludeCompanyName: boolean;
  canPublishNamed: boolean;
  onClose: () => void;
  onPublished: () => void;
}

interface ScheduledPublishState {
  publish_at: string;
  state?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PublishModal({
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
  const [scheduleAt, setScheduleAt] = useState("");
  const [includeCompanyName, setIncludeCompanyName] = useState(initialIncludeCompanyName);

  const [previewLoading, setPreviewLoading] = useState(true);
  const [originalBody, setOriginalBody] = useState("");
  const [scrubbedBody, setScrubbedBody] = useState("");
  const [replacementCount, setReplacementCount] = useState(0);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [publishing, setPublishing] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [cancellingSchedule, setCancellingSchedule] = useState(false);
  const [scheduledState, setScheduledState] = useState<ScheduledPublishState | null>(null);
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

  const loadScheduledState = useCallback(async () => {
    try {
      const data = await getScheduledPagePublish(pageId);
      if (data.scheduled && data.publish_at) {
        setScheduledState({ publish_at: data.publish_at, state: data.state });
      } else {
        setScheduledState(null);
      }
    } catch {
      setScheduledState(null);
    }
  }, [pageId]);

  useEffect(() => {
    loadPreview();
    void loadScheduledState();
  }, [loadPreview, loadScheduledState]);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "Tab" && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    requestAnimationFrame(() => { modalRef.current?.focus(); });
    return () => { document.removeEventListener("keydown", handleKeyDown); previousFocusRef.current?.focus(); };
  }, [onClose]);

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === overlayRef.current) onClose();
  };

  const handlePublish = async () => {
    setPublishError(null);
    if (password && password.length < 4) { setPublishError("Password must be at least 4 characters."); return; }
    setPublishing(true);
    const publishBody: { visibility: string; password?: string; expires_at?: string; include_company_name?: boolean; release_notes?: string; } = { visibility };
    if (password) publishBody.password = password;
    if (expirationDate) publishBody.expires_at = new Date(expirationDate).toISOString();
    if (releaseNotes.trim()) publishBody.release_notes = releaseNotes.trim();
    if (canPublishNamed) publishBody.include_company_name = includeCompanyName;

    try {
      const result = await publishPage(pageId, publishBody);
      if (result.queued_for_approval) {
        setPublishError(`Publish queued for approval${result.request_id ? ` (request ${result.request_id})` : ""}.`);
        onPublished();
        return;
      }
      setPublishedUrl(result.url ?? null);
      onPublished();
    } catch (err: unknown) {
      setPublishError(err instanceof Error ? err.message : "Publish failed. Please try again.");
    } finally {
      setPublishing(false);
    }
  };

  const handleSchedulePublish = async () => {
    setPublishError(null);
    if (!scheduleAt) { setPublishError("Select a future schedule time."); return; }
    if (password && password.length < 4) { setPublishError("Password must be at least 4 characters."); return; }
    const scheduleDate = new Date(scheduleAt);
    if (Number.isNaN(scheduleDate.getTime()) || scheduleDate.getTime() <= Date.now()) { setPublishError("Schedule time must be in the future."); return; }
    setScheduling(true);
    try {
      const payload: { publish_at: string; visibility: string; password?: string; expires_at?: string; release_notes?: string; } = { publish_at: scheduleDate.toISOString(), visibility };
      if (password) payload.password = password;
      if (expirationDate) payload.expires_at = new Date(expirationDate).toISOString();
      if (releaseNotes.trim()) payload.release_notes = releaseNotes.trim();
      const scheduled = await schedulePagePublish(pageId, payload);
      setScheduledState({ publish_at: scheduled.publish_at, state: "delayed" });
      setPublishError("Publish scheduled successfully.");
      onPublished();
    } catch (err: unknown) {
      setPublishError(err instanceof Error ? err.message : "Failed to schedule publish.");
    } finally {
      setScheduling(false);
    }
  };

  const handleCancelScheduledPublish = async () => {
    setPublishError(null);
    setCancellingSchedule(true);
    try {
      await cancelScheduledPagePublish(pageId);
      setScheduledState(null);
      setPublishError("Scheduled publish cancelled.");
    } catch (err: unknown) {
      setPublishError(err instanceof Error ? err.message : "Failed to cancel scheduled publish.");
    } finally {
      setCancellingSchedule(false);
    }
  };

  const handleCopyUrl = async () => {
    if (!publishedUrl) return;
    try { await navigator.clipboard.writeText(publishedUrl); setCopyFeedback(true); setTimeout(() => setCopyFeedback(false), 2000); } catch { /* no-op */ }
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
          <button type="button" className="page-editor__modal-close" onClick={onClose} aria-label="Close">x</button>
        </div>

        {!isSuccessState ? (
          <div className="page-editor__modal-body">
            <div className="page-editor__publish-settings">
              {scheduledState && (
                <div className="page-editor__field page-editor__field--full">
                  <div className="page-editor__toggle-row">
                    <div>
                      <div className="page-editor__toggle-row-label">Scheduled Publish Active</div>
                      <div className="page-editor__toggle-row-desc">
                        {new Date(scheduledState.publish_at).toLocaleString()} ({scheduledState.state ?? "queued"})
                      </div>
                    </div>
                    <button type="button" className="page-editor__btn page-editor__btn--secondary page-editor__btn--sm" onClick={() => void handleCancelScheduledPublish()} disabled={cancellingSchedule}>
                      {cancellingSchedule ? "Cancelling..." : "Cancel Schedule"}
                    </button>
                  </div>
                </div>
              )}

              <div className="page-editor__field">
                <label className="page-editor__field-label">Visibility</label>
                <div className="page-editor__toggle-group">
                  <button type="button" className={`page-editor__toggle-option ${visibility === "PRIVATE" ? "page-editor__toggle-option--active" : ""}`} onClick={() => setVisibility("PRIVATE")}>Private</button>
                  <button type="button" className={`page-editor__toggle-option ${visibility === "SHARED_WITH_LINK" ? "page-editor__toggle-option--active" : ""}`} onClick={() => setVisibility("SHARED_WITH_LINK")}>Shared with Link</button>
                </div>
              </div>

              <div className="page-editor__field">
                <label className="page-editor__field-label" htmlFor="publish-password">Password Protection</label>
                <input id="publish-password" type="password" className="page-editor__text-input" placeholder="Leave empty for no password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={4} maxLength={100} />
              </div>

              <div className="page-editor__field">
                <label className="page-editor__field-label" htmlFor="publish-expiration">Expiration Date</label>
                <input id="publish-expiration" type="datetime-local" className="page-editor__text-input" value={expirationDate} onChange={(e) => setExpirationDate(e.target.value)} />
              </div>

              <div className="page-editor__field">
                <label className="page-editor__field-label" htmlFor="publish-schedule-at">Schedule Publish Time</label>
                <input id="publish-schedule-at" type="datetime-local" className="page-editor__text-input" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} />
              </div>

              <div className="page-editor__field page-editor__field--full">
                <label className="page-editor__field-label" htmlFor="publish-release-notes">Release Notes</label>
                <textarea id="publish-release-notes" className="page-editor__text-input" value={releaseNotes} onChange={(e) => setReleaseNotes(e.target.value)} maxLength={1000} rows={3} placeholder="Describe what changed in this publish..." />
              </div>

              {canPublishNamed && (
                <div className="page-editor__field page-editor__field--full">
                  <div className="page-editor__toggle-row">
                    <input type="checkbox" id="includeCompanyName" checked={includeCompanyName} onChange={handleCompanyNameToggle} />
                    <div>
                      <div className="page-editor__toggle-row-label">Include company name</div>
                      <div className="page-editor__toggle-row-desc">Show the real company name instead of anonymizing it.</div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="page-editor__preview-section">
              <div className="page-editor__preview-header">
                <span className="page-editor__preview-title">Scrub Preview</span>
                {!previewLoading && !previewError && (
                  <span className="page-editor__preview-badge">{replacementCount} replacement{replacementCount !== 1 ? "s" : ""}</span>
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
              <button type="button" className="page-editor__btn page-editor__btn--primary page-editor__btn--sm" onClick={handleCopyUrl}>
                {copyFeedback ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
        )}

        {!isSuccessState && (
          <div className="page-editor__modal-footer">
            <div className="page-editor__modal-footer-left">Review the scrub preview before publishing.</div>
            <div className="page-editor__modal-footer-right">
              <button type="button" className="page-editor__btn page-editor__btn--secondary" onClick={onClose}>Cancel</button>
              <button type="button" className="page-editor__btn page-editor__btn--secondary" onClick={() => void handleSchedulePublish()} disabled={publishing || scheduling || previewLoading}>
                {scheduling ? "Scheduling..." : "Schedule Publish"}
              </button>
              <button type="button" className="page-editor__btn page-editor__btn--primary" onClick={handlePublish} disabled={publishing || scheduling || previewLoading}>
                {publishing ? "Publishing..." : "Publish Page"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
