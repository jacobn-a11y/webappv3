import { useEffect, useState } from "react";
import {
  createIpAllowlistEntry,
  deleteIpAllowlistEntry,
  getIpAllowlistEntries,
  getScimProvisioning,
  getSecuritySessions,
  getSecurityPolicySettings,
  revokeSecuritySession,
  rotateScimToken,
  updateIpAllowlistEntry,
  updateScimProvisioning,
  updateSecurityPolicySettings,
  type IpAllowlistEntry,
  type ScimProvisioningSettings,
  type SecuritySession,
  type SecurityPolicySettings,
} from "../lib/api";

const DEFAULT_POLICY: SecurityPolicySettings = {
  enforce_mfa_for_admin_actions: false,
  sso_enforced: false,
  allowed_sso_domains: [],
  session_controls_enabled: false,
  max_session_age_hours: 720,
  reauth_interval_minutes: 60,
  ip_allowlist_enabled: false,
  ip_allowlist: [],
};

export function AdminSecurityPolicyPage() {
  const [policy, setPolicy] = useState<SecurityPolicySettings>(DEFAULT_POLICY);
  const [allowedDomainsText, setAllowedDomainsText] = useState("");
  const [ipAllowlistText, setIpAllowlistText] = useState("");
  const [ipEntries, setIpEntries] = useState<IpAllowlistEntry[]>([]);
  const [newCidr, setNewCidr] = useState("");
  const [newCidrLabel, setNewCidrLabel] = useState("");
  const [sessions, setSessions] = useState<SecuritySession[]>([]);
  const [scim, setScim] = useState<ScimProvisioningSettings | null>(null);
  const [newScimToken, setNewScimToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      getSecurityPolicySettings(),
      getIpAllowlistEntries(),
      getSecuritySessions(),
      getScimProvisioning(),
    ])
      .then(([policyRes, ipRes, sessionRes, scimRes]) => {
        setPolicy(policyRes);
        setAllowedDomainsText((policyRes.allowed_sso_domains ?? []).join(", "));
        setIpAllowlistText((policyRes.ip_allowlist ?? []).join(", "));
        setIpEntries(ipRes.entries);
        setSessions(sessionRes.sessions);
        setScim(scimRes);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load policy")
      )
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await updateSecurityPolicySettings({
        ...policy,
        allowed_sso_domains: allowedDomainsText
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean),
        ip_allowlist: ipAllowlistText
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      });
      setNotice("Security policy saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save policy");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="state-view" role="status" aria-live="polite"><div className="spinner" /><div className="state-view__title">Loading security policy...</div></div>;

  const addIpEntry = async () => {
    if (!newCidr.trim()) return;
    await createIpAllowlistEntry({
      cidr: newCidr.trim(),
      label: newCidrLabel.trim() || undefined,
      enabled: true,
    });
    const refreshed = await getIpAllowlistEntries();
    setIpEntries(refreshed.entries);
    setNewCidr("");
    setNewCidrLabel("");
  };

  const revokeSession = async (id: string) => {
    await revokeSecuritySession(id);
    const refreshed = await getSecuritySessions();
    setSessions(refreshed.sessions);
  };

  const rotateToken = async () => {
    const res = await rotateScimToken();
    setNewScimToken(res.token);
    const refreshed = await getScimProvisioning();
    setScim(refreshed);
  };

  return (
    <div className="page">
      <div className="page__header"><div className="page__header-text"><h1 className="page__title">Security Policy</h1><p className="page__subtitle">Configure authentication, session controls, and access policies</p></div></div>
      {error && <div className="alert alert--error" role="alert">{error}</div>}
      {notice && <div className="alert alert--success" role="status" aria-live="polite">{notice}</div>}

      <section className="card card--elevated">
        <label className="form-row">
          <input
            type="checkbox"
            checked={policy.enforce_mfa_for_admin_actions}
            onChange={(e) =>
              setPolicy((p) => ({
                ...p,
                enforce_mfa_for_admin_actions: e.target.checked,
              }))
            }
          />
          Enforce MFA for admin actions
        </label>

        <label className="form-row">
          <input
            type="checkbox"
            checked={policy.sso_enforced ?? false}
            onChange={(e) =>
              setPolicy((p) => ({
                ...p,
                sso_enforced: e.target.checked,
              }))
            }
          />
          Enforce SSO-only authentication
        </label>

        <label className="form-group">
          Allowed SSO domains (comma-separated)
          <input
            value={allowedDomainsText}
            onChange={(e) => setAllowedDomainsText(e.target.value)}
            placeholder="example.com, subdomain.example.com"
          />
        </label>

        <label className="form-row">
          <input
            type="checkbox"
            checked={policy.session_controls_enabled ?? false}
            onChange={(e) =>
              setPolicy((p) => ({
                ...p,
                session_controls_enabled: e.target.checked,
              }))
            }
          />
          Enable session policy enforcement
        </label>

        <label className="form-group">
          Max session age (hours)
          <input
            type="number"
            min={1}
            max={2160}
            value={policy.max_session_age_hours ?? 720}
            onChange={(e) =>
              setPolicy((p) => ({
                ...p,
                max_session_age_hours: Number(e.target.value) || 720,
              }))
            }
            disabled={!policy.session_controls_enabled}
          />
        </label>

        <label className="form-group">
          Sensitive-action re-auth window (minutes)
          <input
            type="number"
            min={5}
            max={1440}
            value={policy.reauth_interval_minutes ?? 60}
            onChange={(e) =>
              setPolicy((p) => ({
                ...p,
                reauth_interval_minutes: Number(e.target.value) || 60,
              }))
            }
            disabled={!policy.session_controls_enabled}
          />
        </label>

        <label className="form-row">
          <input
            type="checkbox"
            checked={policy.ip_allowlist_enabled}
            onChange={(e) =>
              setPolicy((p) => ({
                ...p,
                ip_allowlist_enabled: e.target.checked,
              }))
            }
          />
          Enable IP allowlist
        </label>

        <label className="form-group">
          Allowed IPs (comma-separated)
          <input
            value={ipAllowlistText}
            onChange={(e) => setIpAllowlistText(e.target.value)}
            placeholder="203.0.113.10, 198.51.100.21"
            disabled={!policy.ip_allowlist_enabled}
          />
        </label>
      </section>

      <section className="card card--elevated">
        <h2>IP Allowlist Entries</h2>
        <div className="form-row">
          <input
            value={newCidr}
            onChange={(e) => setNewCidr(e.target.value)}
            placeholder="203.0.113.10/32"
          />
          <input
            value={newCidrLabel}
            onChange={(e) => setNewCidrLabel(e.target.value)}
            placeholder="Office VPN"
          />
          <button className="btn btn--secondary" onClick={addIpEntry}>
            Add
          </button>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>CIDR</th>
              <th>Label</th>
              <th>Enabled</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {ipEntries.map((e) => (
              <tr key={e.id}>
                <td>{e.cidr}</td>
                <td>{e.label ?? "-"}</td>
                <td>{e.enabled ? "Yes" : "No"}</td>
                <td>
                  <button
                    className="btn btn--secondary"
                    onClick={async () => {
                      await updateIpAllowlistEntry(e.id, { enabled: !e.enabled });
                      const refreshed = await getIpAllowlistEntries();
                      setIpEntries(refreshed.entries);
                    }}
                  >
                    {e.enabled ? "Disable" : "Enable"}
                  </button>{" "}
                  <button
                    className="btn btn--secondary"
                    onClick={async () => {
                      await deleteIpAllowlistEntry(e.id);
                      const refreshed = await getIpAllowlistEntries();
                      setIpEntries(refreshed.entries);
                    }}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card card--elevated">
        <h2>Active Sessions / Devices</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>User</th>
              <th>IP</th>
              <th>Last Seen</th>
              <th>Expires</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id}>
                <td>{s.user_name ?? s.user_email}</td>
                <td>{s.ip_address ?? "-"}</td>
                <td>{new Date(s.last_seen_at).toLocaleString()}</td>
                <td>{new Date(s.expires_at).toLocaleString()}</td>
                <td>{s.revoked_at ? "Revoked" : "Active"}</td>
                <td>
                  {!s.revoked_at && (
                    <button
                      className="btn btn--secondary"
                      onClick={() => revokeSession(s.id)}
                    >
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card card--elevated">
        <h2>SCIM Provisioning</h2>
        <label className="form-row">
          <input
            type="checkbox"
            checked={scim?.enabled ?? false}
            onChange={async (e) => {
              await updateScimProvisioning(e.target.checked);
              const refreshed = await getScimProvisioning();
              setScim(refreshed);
            }}
          />
          Enable SCIM
        </label>
        <div>Last sync: {scim?.last_sync_at ? new Date(scim.last_sync_at).toLocaleString() : "-"}</div>
        <div>Provisioned identities: {scim?.identities_count ?? 0}</div>
        <div>Token hint: {scim?.endpoint_secret_hint ?? "-"}</div>
        <button className="btn btn--secondary" onClick={rotateToken}>
          Rotate SCIM Token
        </button>
        {newScimToken && (
          <div className="alert alert--success">
            New SCIM token (copy now): <code>{newScimToken}</code>
          </div>
        )}
      </section>

      <div>
        <button className="btn btn--primary" onClick={save} disabled={saving}>
          {saving ? "Saving..." : "Save Security Policy"}
        </button>
      </div>
    </div>
  );
}
