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
  type ArtifactVersion,
  type EditorPageData,
  type SavePageDraftConflict,
} from "../lib/api";
import { formatEnumLabel } from "../lib/format";
import { InlineConfirmDialog } from "../components/InlineConfirmDialog";
import { PublishModal } from "../components/PublishModal";

// ─── Validation helpers ──────────────────────────────────────────────────────

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

function getPostPublishValidation(
  provenance: Record<string, unknown> | null,
): PostPublishValidationSnapshot | null {
  if (!provenance || typeof provenance !== "object") {
    return null;
  }
  const raw = (provenance as { post_publish_validation?: unknown }).post_publish_validation;
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const validation = raw as Partial<PostPublishValidationSnapshot>;
  if (
    (validation.status !== "PASS" && validation.status !== "FAIL") ||
    typeof validation.checked_at !== "string"
  ) {
    return null;
  }
  return {
    status: validation.status,
    checked_at: validation.checked_at,
    links_checked:
      typeof validation.links_checked === "number" ? validation.links_checked : 0,
    broken_links: Array.isArray(validation.broken_links)
      ? (validation.broken_links as PostPublishValidationSnapshot["broken_links"])
      : [],
  };
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function LandingPageEditorPage() {
  const { pageId } = useParams<{ pageId: string }>();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageData, setPageData] = useState<EditorPageData | null>(null);
  const [body, setBody] = useState("");
  const [status, setStatus] = useState("DRAFT");
  const [editorVersion, setEditorVersion] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveConflict, setSaveConflict] = useState<SavePageDraftConflict | null>(null);
  const [conflictDraftBody, setConflictDraftBody] = useState<string | null>(null);

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
      setEditorVersion(data.updatedAt);
      setSaveConflict(null);
      setConflictDraftBody(null);
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
      const result = await savePageDraft(pageId, body, {
        expectedUpdatedAt: editorVersion ?? undefined,
        allowConflict: true,
      });
      if (result.conflict) {
        setSaveConflict(result);
        setConflictDraftBody(body);
        setSaveMessage("Save conflict detected");
        setTimeout(() => setSaveMessage(null), 3000);
        return;
      }
      setEditorVersion(result.updated_at);
      setSaveConflict(null);
      setConflictDraftBody(null);
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
  }, [pageId, body, editorVersion]);

  // Autosave after 30s of inactivity
  const handleBodyChange = useCallback((newBody: string) => {
    setBody(newBody);
    setHasUnsavedChanges(true);
    if (saveConflict) {
      setConflictDraftBody(newBody);
    }
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      if (pageId && newBody) {
        savePageDraft(pageId, newBody, {
          expectedUpdatedAt: editorVersion ?? undefined,
          allowConflict: true,
        })
          .then((result) => {
            if (result.conflict) {
              setSaveConflict(result);
              setConflictDraftBody(newBody);
              setSaveMessage("Autosave conflict detected");
              setTimeout(() => setSaveMessage(null), 3000);
              return;
            }
            setEditorVersion(result.updated_at);
            setSaveConflict(null);
            setConflictDraftBody(null);
            setSaveMessage("Autosaved");
            setHasUnsavedChanges(false);
            setLastSavedAt(new Date());
            setTimeout(() => setSaveMessage(null), 2000);
          })
          .catch(() => {
            setSaveMessage("Autosave failed");
            setTimeout(() => setSaveMessage(null), 3000);
          });
      }
    }, 30000);
  }, [editorVersion, pageId, saveConflict]);

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
    [],
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

  const loadLatestConflictVersion = useCallback(() => {
    if (!saveConflict) return;
    setBody(saveConflict.latest_editable_body);
    setEditorVersion(saveConflict.current_updated_at);
    setHasUnsavedChanges(false);
    setSaveConflict(null);
    setConflictDraftBody(null);
    setSaveMessage("Loaded latest saved version");
    setTimeout(() => setSaveMessage(null), 2500);
  }, [saveConflict]);

  const overwriteConflictVersion = useCallback(async () => {
    if (!pageId || !saveConflict || conflictDraftBody == null) {
      return;
    }
    setSaving(true);
    setSaveMessage(null);
    try {
      const result = await savePageDraft(pageId, conflictDraftBody, {
        expectedUpdatedAt: saveConflict.current_updated_at,
        allowConflict: true,
      });
      if (result.conflict) {
        setSaveConflict(result);
        setSaveMessage("Conflict still active");
        setTimeout(() => setSaveMessage(null), 3000);
        return;
      }
      setBody(conflictDraftBody);
      setEditorVersion(result.updated_at);
      setHasUnsavedChanges(false);
      setLastSavedAt(new Date());
      setSaveConflict(null);
      setConflictDraftBody(null);
      setSaveMessage("Draft saved after conflict resolution");
      setTimeout(() => setSaveMessage(null), 3000);
    } catch {
      setSaveMessage("Save failed");
      setTimeout(() => setSaveMessage(null), 3000);
    } finally {
      setSaving(false);
    }
  }, [conflictDraftBody, pageId, saveConflict]);

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
      <h1 className="sr-only">Landing Page Editor</h1>
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

      {saveConflict && (
        <section className="page-editor__conflict" role="alert">
          <p className="page-editor__conflict-message">
            Another editor saved a newer draft at{" "}
            {new Date(saveConflict.current_updated_at).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
            . Choose how to resolve this conflict.
          </p>
          <div className="page-editor__conflict-actions">
            <button
              type="button"
              className="page-editor__btn page-editor__btn--secondary page-editor__btn--sm"
              onClick={loadLatestConflictVersion}
            >
              Load Latest
            </button>
            <button
              type="button"
              className="page-editor__btn page-editor__btn--primary page-editor__btn--sm"
              onClick={() => void overwriteConflictVersion()}
              disabled={saving || conflictDraftBody == null}
            >
              Overwrite With My Draft
            </button>
          </div>
        </section>
      )}

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
                  <strong>v{v.version_number}</strong> · {formatEnumLabel(v.status)}
                  <div className="page-editor__version-meta">
                    {new Date(v.created_at).toLocaleString()}
                    {v.release_notes ? ` · ${v.release_notes}` : ""}
                  </div>
                  {(() => {
                    const validation = getPostPublishValidation(v.provenance);
                    if (!validation) {
                      return (
                        <div className="page-editor__validation page-editor__validation--pending">
                          Validation pending
                        </div>
                      );
                    }
                    return (
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
                    );
                  })()}
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
