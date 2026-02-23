import { Link } from "react-router-dom";

interface BreadcrumbItem {
  label: string;
  to?: string;
}

export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav className="breadcrumb" aria-label="Breadcrumb">
      <ol className="breadcrumb__list">
        {items.map((item, i) => (
          <li key={i} className="breadcrumb__item">
            {i > 0 && (
              <span className="breadcrumb__separator" aria-hidden="true">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9,18 15,12 9,6" /></svg>
              </span>
            )}
            {item.to && i < items.length - 1 ? (
              <Link to={item.to} className="breadcrumb__link">{item.label}</Link>
            ) : (
              <span className="breadcrumb__current" aria-current={i === items.length - 1 ? "page" : undefined}>{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
