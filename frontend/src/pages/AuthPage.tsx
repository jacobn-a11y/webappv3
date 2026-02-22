import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  getSsoAuthorizationUrl,
  loginWithPassword,
  signupWithPassword,
} from "../lib/api";

type Mode = "login" | "signup";

function resolveMode(search: string): Mode {
  const params = new URLSearchParams(search);
  return params.get("mode") === "signup" ? "signup" : "login";
}

export function AuthPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const mode = useMemo(() => resolveMode(location.search), [location.search]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      if (mode === "signup") {
        await signupWithPassword({
          email,
          password,
          name: name || undefined,
          organizationName: organizationName || undefined,
        });
      } else {
        await loginWithPassword({ email, password });
      }
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  };

  const startSso = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const url = await getSsoAuthorizationUrl(
        mode === "signup" ? "sign-up" : "sign-in"
      );
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start SSO login");
      setSubmitting(false);
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void submit();
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-card__title">
          {mode === "signup" ? "Create your workspace" : "Sign in"}
        </h1>
        <p className="auth-card__subtitle">
          {mode === "signup"
            ? "Self-serve onboarding with no sales handoff."
            : "Use your workspace credentials to continue."}
        </p>

        {error && (
          <div className="auth-card__error" role="alert" id="auth-error">
            {error}
          </div>
        )}

        <form onSubmit={handleFormSubmit} noValidate>
          <label className="auth-card__field">
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "auth-error" : undefined}
            />
          </label>

          {mode === "signup" && (
            <>
              <label className="auth-card__field">
                Full name
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                />
              </label>
              <label className="auth-card__field">
                Company name
                <input
                  value={organizationName}
                  onChange={(e) => setOrganizationName(e.target.value)}
                  placeholder="Acme Inc."
                />
              </label>
            </>
          )}

          <label className="auth-card__field">
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              required
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "auth-error" : undefined}
            />
          </label>

          <button type="submit" className="btn btn--primary auth-card__submit" disabled={submitting}>
            {mode === "signup" ? "Create account" : "Sign in"}
          </button>
        </form>
        <button className="btn btn--secondary auth-card__submit" onClick={startSso} disabled={submitting}>
          Continue with Google SSO
        </button>

        <div className="auth-card__switch">
          {mode === "signup" ? (
            <>
              Already have an account? <Link to="/auth?mode=login">Sign in</Link>
            </>
          ) : (
            <>
              New here? <Link to="/auth?mode=signup">Create an account</Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
