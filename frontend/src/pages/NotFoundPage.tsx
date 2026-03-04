export function NotFoundPage() {
  return (
    <div className="not-found-page" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh", gap: "16px" }}>
      <h1 style={{ fontSize: "72px", fontWeight: 700, color: "var(--color-text-muted)", margin: 0 }}>404</h1>
      <p style={{ fontSize: "18px", color: "var(--color-text-secondary)" }}>Page not found</p>
      <a href="/" style={{ color: "var(--color-accent)", textDecoration: "none", fontWeight: 500 }}>Go to dashboard</a>
    </div>
  );
}
