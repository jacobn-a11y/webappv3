import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  assignRoleProfile,
  createRoleProfile,
  deleteRoleProfile,
  getRoleProfiles,
  updateRoleProfile,
  type RoleAssignableUser,
  type RoleProfile,
  type UpsertRoleProfileRequest,
} from "../lib/api";

const PERMISSIONS = [
  "CREATE_LANDING_PAGE",
  "PUBLISH_LANDING_PAGE",
  "PUBLISH_NAMED_LANDING_PAGE",
  "EDIT_ANY_LANDING_PAGE",
  "DELETE_ANY_LANDING_PAGE",
  "MANAGE_PERMISSIONS",
  "VIEW_ANALYTICS",
  "MANAGE_ENTITY_RESOLUTION",
  "MANAGE_AI_SETTINGS",
] as const;

type RoleFormState = {
  key: string;
  name: string;
  description: string;
  permissions: string[];
  can_access_anonymous_stories: boolean;
  can_generate_anonymous_stories: boolean;
  can_access_named_stories: boolean;
  can_generate_named_stories: boolean;
  default_account_scope_type: "ALL_ACCOUNTS" | "SINGLE_ACCOUNT" | "ACCOUNT_LIST" | "CRM_REPORT";
  default_account_ids: string;
  max_tokens_per_day: string;
  max_tokens_per_month: string;
  max_requests_per_day: string;
  max_requests_per_month: string;
  max_stories_per_month: string;
};

const DEFAULT_FORM: RoleFormState = {
  key: "",
  name: "",
  description: "",
  permissions: ["VIEW_ANALYTICS"],
  can_access_anonymous_stories: true,
  can_generate_anonymous_stories: true,
  can_access_named_stories: false,
  can_generate_named_stories: false,
  default_account_scope_type: "ACCOUNT_LIST",
  default_account_ids: "",
  max_tokens_per_day: "",
  max_tokens_per_month: "",
  max_requests_per_day: "",
  max_requests_per_month: "",
  max_stories_per_month: "",
};

export function AdminRolesPage() {
  const [roles, setRoles] = useState<RoleProfile[]>([]);
  const [users, setUsers] = useState<RoleAssignableUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [form, setForm] = useState<RoleFormState>(DEFAULT_FORM);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getRoleProfiles();
      setRoles(data.roles);
      setUsers(data.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load roles");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const resetForm = () => {
    setEditingRoleId(null);
    setForm(DEFAULT_FORM);
  };

  const payload = useMemo<UpsertRoleProfileRequest>(() => {
    const toNumber = (v: string): number | null =>
      v.trim() === "" ? null : Number(v);
    return {
      key: form.key.trim().toUpperCase(),
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      permissions: form.permissions,
      can_access_anonymous_stories: form.can_access_anonymous_stories,
      can_generate_anonymous_stories: form.can_generate_anonymous_stories,
      can_access_named_stories: form.can_access_named_stories,
      can_generate_named_stories: form.can_generate_named_stories,
      default_account_scope_type: form.default_account_scope_type,
      default_account_ids: form.default_account_ids
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      max_tokens_per_day: toNumber(form.max_tokens_per_day),
      max_tokens_per_month: toNumber(form.max_tokens_per_month),
      max_requests_per_day: toNumber(form.max_requests_per_day),
      max_requests_per_month: toNumber(form.max_requests_per_month),
      max_stories_per_month: toNumber(form.max_stories_per_month),
    };
  }, [form]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (editingRoleId) {
        await updateRoleProfile(editingRoleId, payload);
      } else {
        await createRoleProfile(payload);
      }
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save role");
    } finally {
      setSaving(false);
    }
  };

  const onEdit = (role: RoleProfile) => {
    setEditingRoleId(role.id);
    setForm({
      key: role.key,
      name: role.name,
      description: role.description ?? "",
      permissions: role.permissions,
      can_access_anonymous_stories: role.canAccessAnonymousStories,
      can_generate_anonymous_stories: role.canGenerateAnonymousStories,
      can_access_named_stories: role.canAccessNamedStories,
      can_generate_named_stories: role.canGenerateNamedStories,
      default_account_scope_type: role.defaultAccountScopeType as RoleFormState["default_account_scope_type"],
      default_account_ids: role.defaultAccountIds.join(","),
      max_tokens_per_day: role.maxTokensPerDay?.toString() ?? "",
      max_tokens_per_month: role.maxTokensPerMonth?.toString() ?? "",
      max_requests_per_day: role.maxRequestsPerDay?.toString() ?? "",
      max_requests_per_month: role.maxRequestsPerMonth?.toString() ?? "",
      max_stories_per_month: role.maxStoriesPerMonth?.toString() ?? "",
    });
  };

  const onDelete = async (role: RoleProfile) => {
    if (role.isPreset) return;
    setSaving(true);
    setError(null);
    try {
      await deleteRoleProfile(role.id);
      if (editingRoleId === role.id) resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete role");
    } finally {
      setSaving(false);
    }
  };

  const onAssign = async (userId: string, roleProfileId: string) => {
    if (!roleProfileId) return;
    setSaving(true);
    setError(null);
    try {
      await assignRoleProfile(userId, roleProfileId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assign role");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="admin-roles__page">Loading roles...</div>;
  }

  return (
    <div className="admin-roles__page">
      <h1 className="admin-roles__title">Role Profiles</h1>
      <p className="admin-roles__subtitle">
        Configure preset and custom team roles, usage limits, account scope, and named/anonymous story permissions.
      </p>

      {error && <div className="admin-roles__error">{error}</div>}

      <form className="admin-roles__form" onSubmit={onSubmit}>
        <h2>{editingRoleId ? "Edit Role" : "Create Custom Role"}</h2>
        <div className="admin-roles__grid">
          <label>
            Key
            <input
              value={form.key}
              onChange={(e) => setForm((p) => ({ ...p, key: e.target.value }))}
              required
              disabled={saving}
            />
          </label>
          <label>
            Name
            <input
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              required
              disabled={saving}
            />
          </label>
          <label className="admin-roles__wide">
            Description
            <input
              value={form.description}
              onChange={(e) =>
                setForm((p) => ({ ...p, description: e.target.value }))
              }
              disabled={saving}
            />
          </label>
          <label>
            Default Account Scope
            <select
              value={form.default_account_scope_type}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  default_account_scope_type: e.target.value as RoleFormState["default_account_scope_type"],
                }))
              }
              disabled={saving}
            >
              <option value="ALL_ACCOUNTS">ALL_ACCOUNTS</option>
              <option value="SINGLE_ACCOUNT">SINGLE_ACCOUNT</option>
              <option value="ACCOUNT_LIST">ACCOUNT_LIST</option>
              <option value="CRM_REPORT">CRM_REPORT</option>
            </select>
          </label>
          <label className="admin-roles__wide">
            Default Account IDs (comma-separated)
            <input
              value={form.default_account_ids}
              onChange={(e) =>
                setForm((p) => ({ ...p, default_account_ids: e.target.value }))
              }
              disabled={saving}
            />
          </label>
          <label>
            Max Tokens / Day
            <input
              type="number"
              min={0}
              value={form.max_tokens_per_day}
              onChange={(e) =>
                setForm((p) => ({ ...p, max_tokens_per_day: e.target.value }))
              }
              disabled={saving}
            />
          </label>
          <label>
            Max Tokens / Month
            <input
              type="number"
              min={0}
              value={form.max_tokens_per_month}
              onChange={(e) =>
                setForm((p) => ({ ...p, max_tokens_per_month: e.target.value }))
              }
              disabled={saving}
            />
          </label>
          <label>
            Max Requests / Day
            <input
              type="number"
              min={0}
              value={form.max_requests_per_day}
              onChange={(e) =>
                setForm((p) => ({ ...p, max_requests_per_day: e.target.value }))
              }
              disabled={saving}
            />
          </label>
          <label>
            Max Requests / Month
            <input
              type="number"
              min={0}
              value={form.max_requests_per_month}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  max_requests_per_month: e.target.value,
                }))
              }
              disabled={saving}
            />
          </label>
          <label>
            Max Stories / Month
            <input
              type="number"
              min={0}
              value={form.max_stories_per_month}
              onChange={(e) =>
                setForm((p) => ({ ...p, max_stories_per_month: e.target.value }))
              }
              disabled={saving}
            />
          </label>
        </div>

        <div className="admin-roles__flags">
          <label>
            <input
              type="checkbox"
              checked={form.can_access_anonymous_stories}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  can_access_anonymous_stories: e.target.checked,
                }))
              }
            />
            Can access anonymous stories
          </label>
          <label>
            <input
              type="checkbox"
              checked={form.can_generate_anonymous_stories}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  can_generate_anonymous_stories: e.target.checked,
                }))
              }
            />
            Can generate anonymous stories
          </label>
          <label>
            <input
              type="checkbox"
              checked={form.can_access_named_stories}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  can_access_named_stories: e.target.checked,
                }))
              }
            />
            Can access named stories
          </label>
          <label>
            <input
              type="checkbox"
              checked={form.can_generate_named_stories}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  can_generate_named_stories: e.target.checked,
                }))
              }
            />
            Can generate named stories
          </label>
        </div>

        <div className="admin-roles__permissions">
          {PERMISSIONS.map((perm) => (
            <label key={perm}>
              <input
                type="checkbox"
                checked={form.permissions.includes(perm)}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    permissions: e.target.checked
                      ? [...new Set([...p.permissions, perm])]
                      : p.permissions.filter((x) => x !== perm),
                  }))
                }
              />
              {perm}
            </label>
          ))}
        </div>

        <div className="admin-roles__form-actions">
          <button type="submit" className="btn btn--primary" disabled={saving}>
            {editingRoleId ? "Save Role" : "Create Role"}
          </button>
          {editingRoleId && (
            <button
              type="button"
              className="btn btn--secondary"
              onClick={resetForm}
              disabled={saving}
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      <section className="admin-roles__section">
        <h2>Roles</h2>
        <table className="admin-roles__table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Key</th>
              <th>Type</th>
              <th>Permissions</th>
              <th>Story Access</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <tr key={role.id}>
                <td>{role.name}</td>
                <td>{role.key}</td>
                <td>{role.isPreset ? "Preset" : "Custom"}</td>
                <td>{role.permissions.join(", ") || "None"}</td>
                <td>
                  A:{role.canAccessAnonymousStories ? "Y" : "N"}/G:
                  {role.canGenerateAnonymousStories ? "Y" : "N"} | N:
                  {role.canAccessNamedStories ? "Y" : "N"}/G:
                  {role.canGenerateNamedStories ? "Y" : "N"}
                </td>
                <td className="admin-roles__actions">
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    onClick={() => onEdit(role)}
                    disabled={saving}
                  >
                    Edit
                  </button>
                  {!role.isPreset && (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => onDelete(role)}
                      disabled={saving}
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="admin-roles__section">
        <h2>User Assignments</h2>
        <table className="admin-roles__table">
          <thead>
            <tr>
              <th>User</th>
              <th>Base Role</th>
              <th>Assigned Profile</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>{user.name ?? user.email}</td>
                <td>{user.base_role}</td>
                <td>
                  <select
                    value={user.role_profile_id ?? ""}
                    onChange={(e) => onAssign(user.id, e.target.value)}
                    disabled={saving}
                  >
                    <option value="">No profile</option>
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
