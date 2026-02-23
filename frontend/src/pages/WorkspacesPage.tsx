import { useEffect, useState } from "react";
import {
  createTeamWorkspace,
  createSharedAsset,
  deleteTeamWorkspace,
  deleteSharedAsset,
  getSharedAssets,
  getTeamWorkspaces,
  type SharedAsset,
  type TeamWorkspace,
} from "../lib/api";
import { formatEnumLabel, formatDate } from "../lib/format";
import { useToast } from "../components/Toast";

export function WorkspacesPage({ userRole }: { userRole?: string }) {
  const isViewer = userRole === "VIEWER";
  const [workspaces, setWorkspaces] = useState<TeamWorkspace[]>([]);
  const [assets, setAssets] = useState<SharedAsset[]>([]);
  const [name, setName] = useState("");
  const [team, setTeam] = useState<"REVOPS" | "MARKETING" | "SALES" | "CS">("REVOPS");
  const [visibility, setVisibility] = useState<"PRIVATE" | "TEAM" | "ORG">("TEAM");
  const [assetTitle, setAssetTitle] = useState("");
  const [assetType, setAssetType] = useState<"STORY" | "PAGE" | "REPORT" | "PLAYBOOK" | "TEMPLATE">("STORY");
  const [assetVisibility, setAssetVisibility] = useState<"PRIVATE" | "TEAM" | "ORG">("TEAM");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string; type: "workspace" | "asset" } | null>(null);
  const { showToast } = useToast();

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [ws, as] = await Promise.all([getTeamWorkspaces(), getSharedAssets()]);
      setWorkspaces(ws.workspaces);
      setAssets(as.assets);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load workspaces");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const createWorkspace = async () => {
    if (!name.trim()) return;
    setError(null);
    try {
      await createTeamWorkspace({ name: name.trim(), team, visibility });
      setName("");
      showToast("Workspace created", "success");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create workspace");
    }
  };

  const removeWorkspace = async (id: string) => {
    setError(null);
    try {
      await deleteTeamWorkspace(id);
      showToast("Workspace deleted", "info");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete workspace");
    }
  };

  const createAsset = async () => {
    if (!assetTitle.trim()) return;
    setError(null);
    try {
      await createSharedAsset({ asset_type: assetType, title: assetTitle.trim(), visibility: assetVisibility });
      setAssetTitle("");
      showToast("Asset created", "success");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create shared asset");
    }
  };

  const removeAsset = async (id: string) => {
    setError(null);
    try {
      await deleteSharedAsset(id);
      showToast("Asset deleted", "info");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete shared asset");
    }
  };

  return (
    <div className="page">
      <div className="page__header">
        <div className="page__header-text">
          <h1 className="page__title">Team Workspaces</h1>
          <p className="page__subtitle">Manage team workspaces and shared asset library</p>
        </div>
      </div>

      {error && <div className="alert alert--error">{error}</div>}

      {/* Create Workspace */}
      {!isViewer && (
        <div className="card card--elevated">
          <div className="card__header">
            <div className="card__title">Create Workspace</div>
          </div>
          <div className="form-row">
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-group__label">Name</label>
              <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Workspace name" />
            </div>
            <div className="form-group">
              <label className="form-group__label">Team</label>
              <select className="form-select" value={team} onChange={(e) => setTeam(e.target.value as typeof team)}>
                <option value="REVOPS">RevOps</option>
                <option value="MARKETING">Marketing</option>
                <option value="SALES">Sales</option>
                <option value="CS">CS</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-group__label">Visibility</label>
              <select className="form-select" value={visibility} onChange={(e) => setVisibility(e.target.value as typeof visibility)}>
                <option value="PRIVATE">Private</option>
                <option value="TEAM">Team</option>
                <option value="ORG">Organization</option>
              </select>
            </div>
            <button className="btn btn--primary" onClick={createWorkspace}>Create</button>
          </div>
        </div>
      )}

      {/* Workspaces Table */}
      <div className="card card--elevated">
        <div className="card__header">
          <div className="card__title">Workspaces</div>
        </div>
        {loading ? (
          <div className="state-view" style={{ minHeight: 120 }}>
            <div className="spinner spinner--sm" />
          </div>
        ) : (
          <div className="table-container" style={{ border: "none", borderRadius: 0 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Team</th>
                  <th>Visibility</th>
                  <th>Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {workspaces.length === 0 ? (
                  <tr><td colSpan={5} className="data-table__empty">No workspaces yet</td></tr>
                ) : (
                  workspaces.map((w) => (
                    <tr key={w.id}>
                      <td><strong>{w.name}</strong></td>
                      <td><span className="badge badge--accent">{formatEnumLabel(w.team)}</span></td>
                      <td><span className="badge badge--archived">{formatEnumLabel(w.visibility)}</span></td>
                      <td>{formatDate(w.updated_at)}</td>
                      <td>
                        {!isViewer && (
                          <button className="btn btn--ghost btn--sm" style={{ color: "var(--color-error)" }} onClick={() => setConfirmDelete({ id: w.id, name: w.name, type: "workspace" })}>Delete</button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Shared Assets */}
      <div className="card card--elevated">
        <div className="card__header">
          <div>
            <div className="card__title">Shared Asset Library</div>
            <div className="card__subtitle">Collaborate on stories, pages, reports, and more</div>
          </div>
        </div>
        {!isViewer && (
          <div className="form-row" style={{ marginBottom: 16 }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-group__label">Title</label>
              <input className="form-input" value={assetTitle} onChange={(e) => setAssetTitle(e.target.value)} placeholder="Asset title" />
            </div>
            <div className="form-group">
              <label className="form-group__label">Type</label>
              <select className="form-select" value={assetType} onChange={(e) => setAssetType(e.target.value as typeof assetType)}>
                <option value="STORY">Story</option>
                <option value="PAGE">Page</option>
                <option value="REPORT">Report</option>
                <option value="PLAYBOOK">Playbook</option>
                <option value="TEMPLATE">Template</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-group__label">Visibility</label>
              <select className="form-select" value={assetVisibility} onChange={(e) => setAssetVisibility(e.target.value as typeof assetVisibility)}>
                <option value="PRIVATE">Private</option>
                <option value="TEAM">Team</option>
                <option value="ORG">Organization</option>
              </select>
            </div>
            <button className="btn btn--primary" onClick={createAsset}>Add Asset</button>
          </div>
        )}
        <div className="table-container" style={{ border: "none", borderRadius: 0 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Type</th>
                <th>Visibility</th>
                <th>Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {assets.length === 0 ? (
                <tr><td colSpan={5} className="data-table__empty">No shared assets yet</td></tr>
              ) : (
                assets.map((a) => (
                  <tr key={a.id}>
                    <td><strong>{a.title}</strong></td>
                    <td><span className="badge badge--accent">{formatEnumLabel(a.asset_type)}</span></td>
                    <td><span className="badge badge--archived">{formatEnumLabel(a.visibility)}</span></td>
                    <td>{formatDate(a.updated_at)}</td>
                    <td>
                      {!isViewer && (
                        <button className="btn btn--ghost btn--sm" style={{ color: "var(--color-error)" }} onClick={() => setConfirmDelete({ id: a.id, name: a.title, type: "asset" })}>Delete</button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Confirmation Dialog */}
      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="modal modal--sm" onClick={(e) => e.stopPropagation()} role="alertdialog" aria-labelledby="confirm-title" aria-describedby="confirm-msg">
            <h3 id="confirm-title" className="modal__title">Delete {confirmDelete.type === "workspace" ? "Workspace" : "Asset"}</h3>
            <p id="confirm-msg" className="modal__message">
              Are you sure you want to delete <strong>{confirmDelete.name}</strong>? This action cannot be undone.
            </p>
            <div className="modal__actions">
              <button className="btn btn--ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button
                className="btn btn--danger"
                onClick={async () => {
                  if (confirmDelete.type === "workspace") {
                    await removeWorkspace(confirmDelete.id);
                  } else {
                    await removeAsset(confirmDelete.id);
                  }
                  setConfirmDelete(null);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
