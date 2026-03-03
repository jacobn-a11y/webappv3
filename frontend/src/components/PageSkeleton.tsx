export function PageSkeleton() {
  return (
    <div className="page-skeleton" aria-busy="true" aria-label="Loading page content">
      <div className="skeleton skeleton--header" />
      <div className="skeleton skeleton--text" />
      <div className="skeleton skeleton--text skeleton--text-short" />
      <div className="skeleton skeleton--block" />
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="page-skeleton" aria-busy="true" aria-label="Loading data">
      <div className="skeleton skeleton--header" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton skeleton--row" />
      ))}
    </div>
  );
}
