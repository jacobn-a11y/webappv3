/**
 * LandingPageEditorPage — Layout shell, save/load, conflict resolution.
 * Sub-components decomposed into ./editor/
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
import { EditorToolbar } from "./editor/EditorToolbar";
import { PublishModal } from "./editor/PublishModal";
import { VersionHistory, InlineConfirmDialog } from "./editor/VersionHistory";

// Re-export sub-components for backward compatibility
export { EditorToolbar } from "./editor/EditorToolbar";
export { PublishModal } from "./editor/PublishModal";
export { VersionHistory, InlineConfirmDialog } from "./editor/VersionHistory";

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
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => { loadPage(); }, [loadPage]);
  useEffect(() => { loadVersions(); }, [loadVersions]);

  const handleSaveDraft = useCallback(async () => {
    if (!pageId) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      const result = await savePageDraft(pageId, body, { expectedUpdatedAt: editorVersion ?? undefined, allowConflict: true });
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

  const handleBodyChange = useCallback((newBody: string) => {
    setBody(newBody);
    setHasUnsavedChanges(true);
    if (saveConflict) setConflictDraftBody(newBody);
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      if (pageId && newBody) {
        savePageDraft(pageId, newBody, { expectedUpdatedAt: editorVersion ?? undefined, allowConflict: true })
          .then((result) => {
            if (result.conflict) { setSaveConflict(result); setConflictDraftBody(newBody); setSaveMessage("Autosave conflict detected"); setTimeout(() => setSaveMessage(null), 3000); return; }
            setEditorVersion(result.updated_at); setSaveConflict(null); setConflictDraftBody(null); setSaveMessage("Autosaved"); setHasUnsavedChanges(false); setLastSavedAt(new Date()); setTimeout(() => setSaveMessage(null), 2000);
          })
          .catch(() => {});
      }
    }, 30000);
  }, [editorVersion, pageId, saveConflict]);

  useEffect(() => { return () => { if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current); }; }, []);

  const handlePublished = useCallback(() => { setStatus("PUBLISHED"); loadVersions(); }, [loadVersions]);
  const handleRollbackVersion = useCallback((versionId: string) => { setRollbackVersionId(versionId); }, []);

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
    if (!pageId || !saveConflict || conflictDraftBody == null) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      const result = await savePageDraft(pageId, conflictDraftBody, { expectedUpdatedAt: saveConflict.current_updated_at, allowConflict: true });
      if (result.conflict) { setSaveConflict(result); setSaveMessage("Conflict still active"); setTimeout(() => setSaveMessage(null), 3000); return; }
      setBody(conflictDraftBody); setEditorVersion(result.updated_at); setHasUnsavedChanges(false); setLastSavedAt(new Date()); setSaveConflict(null); setConflictDraftBody(null); setSaveMessage("Draft saved after conflict resolution"); setTimeout(() => setSaveMessage(null), 3000);
    } catch { setSaveMessage("Save failed"); setTimeout(() => setSaveMessage(null), 3000); } finally { setSaving(false); }
  }, [conflictDraftBody, pageId, saveConflict]);

  if (!pageId) return <div className="page-editor__error">No page ID provided.</div>;

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
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link to="/dashboard/pages">Pages</Link>
        <span className="breadcrumbs__separator" aria-hidden="true">/</span>
        <span className="breadcrumbs__current">{pageData.title}</span>
      </nav>

      <EditorToolbar
        title={pageData.title}
        status={status}
        hasUnsavedChanges={hasUnsavedChanges}
        saving={saving}
        saveMessage={saveMessage}
        lastSavedAt={lastSavedAt}
        onSaveDraft={() => void handleSaveDraft()}
        onPublish={() => setShowPublishModal(true)}
      />

      {saveConflict && (
        <section className="page-editor__conflict" role="alert">
          <p className="page-editor__conflict-message">
            Another editor saved a newer draft at{" "}
            {new Date(saveConflict.current_updated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.
            Choose how to resolve this conflict.
          </p>
          <div className="page-editor__conflict-actions">
            <button type="button" className="page-editor__btn page-editor__btn--secondary page-editor__btn--sm" onClick={loadLatestConflictVersion}>Load Latest</button>
            <button type="button" className="page-editor__btn page-editor__btn--primary page-editor__btn--sm" onClick={() => void overwriteConflictVersion()} disabled={saving || conflictDraftBody == null}>Overwrite With My Draft</button>
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

      <VersionHistory
        versions={versions}
        versionLoading={versionLoading}
        versionError={versionError}
        onRefresh={() => void loadVersions()}
        onRollback={handleRollbackVersion}
      />

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
          onConfirm={() => void executeRollback()}
          onCancel={() => setRollbackVersionId(null)}
        />
      )}
    </div>
  );
}
