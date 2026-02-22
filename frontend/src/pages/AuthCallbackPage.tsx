import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { completeSsoCallback } from "../lib/api";

export function AuthCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = searchParams.get("code");
    if (!code) {
      setError("Missing authorization code.");
      return;
    }

    completeSsoCallback(code)
      .then(() => navigate("/", { replace: true }))
      .catch((err) =>
        setError(err instanceof Error ? err.message : "SSO callback failed")
      );
  }, [navigate, searchParams]);

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-card__title">Signing you in</h1>
        {!error && <p className="auth-card__subtitle">Completing SSO authentication...</p>}
        {error && (
          <div className="auth-card__error">
            {error} <Link to="/auth?mode=login">Return to sign in</Link>
          </div>
        )}
      </div>
    </div>
  );
}
