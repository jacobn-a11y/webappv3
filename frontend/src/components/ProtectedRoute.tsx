import type { AuthUser } from "../lib/api";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRole?: Array<"OWNER" | "ADMIN" | "MEMBER" | "VIEWER">;
  user: AuthUser;
  fallback?: React.ReactNode;
}

export function ProtectedRoute({
  children,
  requiredRole,
  user,
  fallback,
}: ProtectedRouteProps) {
  if (requiredRole && !requiredRole.includes(user.role)) {
    if (fallback) return <>{fallback}</>;
    return <AccessDenied />;
  }
  return <>{children}</>;
}

export function AccessDenied() {
  return (
    <div className="access-denied">
      <div className="access-denied__icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0110 0v4" />
        </svg>
      </div>
      <h2 className="access-denied__title">Access Restricted</h2>
      <p className="access-denied__message">
        You don't have permission to view this page. Contact your administrator for access.
      </p>
      <a href="/" className="btn btn--primary">Return to Home</a>
    </div>
  );
}
