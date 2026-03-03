import type { ReactNode } from "react";

export function AdminSection(props: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const { title, subtitle, actions, children, className } = props;
  return (
    <section className={`card card--elevated admin-section ${className ?? ""}`.trim()}>
      {(title || subtitle || actions) && (
        <header className="admin-section__header">
          <div className="admin-section__header-text">
            {title && <h2 className="admin-section__title">{title}</h2>}
            {subtitle && <p className="admin-section__subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="admin-section__actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function AdminKpiGrid(props: { children: ReactNode }) {
  return <div className="admin-kpi-grid">{props.children}</div>;
}

export function AdminKpi(props: { label: string; value: ReactNode; hint?: ReactNode }) {
  const { label, value, hint } = props;
  return (
    <article className="admin-kpi">
      <div className="admin-kpi__label">{label}</div>
      <div className="admin-kpi__value">{value}</div>
      {hint != null && <div className="admin-kpi__hint">{hint}</div>}
    </article>
  );
}
