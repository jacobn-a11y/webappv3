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

export function WorkspacesPage() {
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
      await createTeamWorkspace({
        name: name.trim(),
        team,
        visibility,
      });
      setName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create workspace");
    }
  };

  const removeWorkspace = async (id: string) => {
    setError(null);
    try {
      await deleteTeamWorkspace(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete workspace");
    }
  };

  const createAsset = async () => {
    if (!assetTitle.trim()) return;
    setError(null);
    try {
      await createSharedAsset({
        asset_type: assetType,
        title: assetTitle.trim(),
        visibility: assetVisibility,
      });
      setAssetTitle("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create shared asset");
    }
  };

  const removeAsset = async (id: string) => {
    setError(null);
    try {
      await deleteSharedAsset(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete shared asset");
    }
  };

  return (
    <div className="admin-security__page">
      <h1 className="admin-security__title">Team Workspaces</h1>
      {error && <div className="admin-story-context__error">{error}</div>}

      <section className="admin-security__card">
        <h2>Create Workspace</h2>
        <div className="admin-security__inline">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Workspace name"
          />
          <select value={team} onChange={(e) => setTeam(e.target.value as typeof team)}>
            <option value="REVOPS">REVOPS</option>
            <option value="MARKETING">MARKETING</option>
            <option value="SALES">SALES</option>
            <option value="CS">CS</option>
          </select>
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as typeof visibility)}
          >
            <option value="PRIVATE">PRIVATE</option>
            <option value="TEAM">TEAM</option>
            <option value="ORG">ORG</option>
          </select>
          <button className="btn btn--secondary" onClick={createWorkspace}>
            Create
          </button>
        </div>
      </section>

      <section className="admin-security__card">
        <h2>Saved Views / Workspaces</h2>
        {loading ? (
          <div>Loading workspaces...</div>
        ) : (
          <table className="admin-ops__table">
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
              {workspaces.map((w) => (
                <tr key={w.id}>
                  <td>{w.name}</td>
                  <td>{w.team}</td>
                  <td>{w.visibility}</td>
                  <td>{new Date(w.updated_at).toLocaleString()}</td>
                  <td>
                    <button
                      className="btn btn--secondary"
                      onClick={() => removeWorkspace(w.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="admin-security__card">
        <h2>Shared Asset Library</h2>
        <div className="admin-security__inline">
          <input
            value={assetTitle}
            onChange={(e) => setAssetTitle(e.target.value)}
            placeholder="Asset title"
          />
          <select
            value={assetType}
            onChange={(e) =>
              setAssetType(
                e.target.value as "STORY" | "PAGE" | "REPORT" | "PLAYBOOK" | "TEMPLATE"
              )
            }
          >
            <option value="STORY">STORY</option>
            <option value="PAGE">PAGE</option>
            <option value="REPORT">REPORT</option>
            <option value="PLAYBOOK">PLAYBOOK</option>
            <option value="TEMPLATE">TEMPLATE</option>
          </select>
          <select
            value={assetVisibility}
            onChange={(e) => setAssetVisibility(e.target.value as "PRIVATE" | "TEAM" | "ORG")}
          >
            <option value="PRIVATE">PRIVATE</option>
            <option value="TEAM">TEAM</option>
            <option value="ORG">ORG</option>
          </select>
          <button className="btn btn--secondary" onClick={createAsset}>
            Add Asset
          </button>
        </div>
        <table className="admin-ops__table">
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
            {assets.map((a) => (
              <tr key={a.id}>
                <td>{a.title}</td>
                <td>{a.asset_type}</td>
                <td>{a.visibility}</td>
                <td>{new Date(a.updated_at).toLocaleString()}</td>
                <td>
                  <button className="btn btn--secondary" onClick={() => removeAsset(a.id)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
