import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { acceptInvite, getInviteDetails, type InviteSummary } from "../lib/api";

export function InviteAcceptPage() {
  const { token } = useParams();
  const navigate = useNavigate();

  const [invite, setInvite] = useState<InviteSummary | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError("Missing invite token.");
      return;
    }
    getInviteDetails(token)
      .then((res) => setInvite(res.invite))
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load invite")
      );
  }, [token]);

  const submit = async () => {
    if (!token) return;
    setSubmitting(true);
    setError(null);
    try {
      await acceptInvite(token, { password, name: name || undefined });
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to accept invite");
    } finally {
      setSubmitting(false);
    }
  };

  if (error && !invite) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1 className="auth-card__title">Invite unavailable</h1>
          <div className="auth-card__error">{error}</div>
          <Link to="/auth?mode=login">Go to sign in</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-card__title">Join {invite?.organizationName ?? "workspace"}</h1>
        <p className="auth-card__subtitle">
          {invite?.email ? `Invited as ${invite.email}` : "Loading invite details..."}
        </p>
        {error && <div className="auth-card__error">{error}</div>}
        {invite && (
          <>
            <div className="auth-card__invite-meta">Role: {invite.role}</div>
            <label className="auth-card__field">
              Full name
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="auth-card__field">
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </label>
            <button
              className="btn btn--primary auth-card__submit"
              onClick={submit}
              disabled={submitting}
            >
              Accept invite
            </button>
          </>
        )}
      </div>
    </div>
  );
}
