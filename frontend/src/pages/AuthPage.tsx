import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  getSsoAuthorizationUrl,
  loginWithPassword,
  signupWithPassword,
} from "../lib/api";

type Mode = "login" | "signup";

const authSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

function resolveMode(search: string): Mode {
  const params = new URLSearchParams(search);
  return params.get("mode") === "signup" ? "signup" : "login";
}

export function AuthPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const mode = useMemo(() => resolveMode(location.search), [location.search]);

  const {
    register,
    handleSubmit,
    formState: { errors: fieldErrors },
  } = useForm<z.infer<typeof authSchema>>({
    resolver: zodResolver(authSchema),
  });

  const [name, setName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (values: z.infer<typeof authSchema>) => {
    setSubmitting(true);
    setError(null);
    try {
      if (mode === "signup") {
        await signupWithPassword({
          email: values.email,
          password: values.password,
          name: name || undefined,
          organizationName: organizationName || undefined,
        });
      } else {
        await loginWithPassword({ email: values.email, password: values.password });
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

  const onSubmit = handleSubmit((values) => {
    void submit(values);
  });

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

        <form onSubmit={onSubmit} noValidate>
          <label className="auth-card__field">
            Email
            <input
              type="email"
              {...register("email")}
              autoComplete="email"
              required
              aria-invalid={fieldErrors.email ? true : undefined}
              aria-describedby={fieldErrors.email ? "email-error" : error ? "auth-error" : undefined}
            />
            {fieldErrors.email && (
              <span className="auth-card__field-error" id="email-error" role="alert">
                {fieldErrors.email.message}
              </span>
            )}
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
              {...register("password")}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              required
              aria-invalid={fieldErrors.password ? true : undefined}
              aria-describedby={fieldErrors.password ? "password-error" : error ? "auth-error" : undefined}
            />
            {fieldErrors.password && (
              <span className="auth-card__field-error" id="password-error" role="alert">
                {fieldErrors.password.message}
              </span>
            )}
          </label>

          <button type="submit" className="btn btn--primary auth-card__submit" disabled={submitting}>
            {mode === "signup" ? "Create account" : "Sign in"}
          </button>
        </form>
        <button type="button" className="btn btn--secondary auth-card__submit" onClick={startSso} disabled={submitting}>
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
