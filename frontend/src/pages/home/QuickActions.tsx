import { Link } from "react-router-dom";
import type { RoleAwareHome } from "../../lib/api";

const PERSONA_LABELS: Record<RoleAwareHome["persona"], string> = {
  REVOPS_ADMIN: "RevOps Admin",
  MARKETING_ANALYST: "Marketing Analyst",
  SALES_MANAGER: "Sales Manager",
  CSM: "Customer Success Manager",
  EXEC: "Executive",
};

export function mapActionToLink(action: string): string | null {
  const lower = action.toLowerCase();
  if (lower.includes("approv")) return "/admin/publish-approvals";
  if (lower.includes("story") || lower.includes("stories")) return "/accounts";
  if (lower.includes("page")) return "/dashboard/pages";
  if (lower.includes("integration") || lower.includes("connect")) return "/admin/settings/integrations";
  if (lower.includes("security") || lower.includes("mfa")) return "/admin/permissions";
  if (lower.includes("billing") || lower.includes("subscription")) return "/admin/billing";
  if (lower.includes("role") || lower.includes("permission")) return "/admin/permissions";
  if (lower.includes("governance") || lower.includes("retention")) return "/admin/publish-approvals";
  if (lower.includes("analytics") || lower.includes("report")) return "/dashboard/pages";
  if (lower.includes("workspace")) return "/content-queue";
  if (lower.includes("setup") || lower.includes("onboard")) return "/admin/setup";
  return null;
}

export function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export interface QuickActionsProps {
  data: RoleAwareHome;
}

export function QuickActions({ data }: QuickActionsProps) {
  const actions = data.recommended_actions ?? [];
  return (
    <section className="home__quick-actions">
      <h2 className="home__section-title">
        {getGreeting()}, {PERSONA_LABELS[data.persona]}
      </h2>
      {actions.length > 0 && (
        <div className="home__actions-grid">
          {actions.map((action: string, index: number) => {
            const link = mapActionToLink(action);
            return link ? (
              <Link key={index} to={link} className="home__action-card">
                {action}
              </Link>
            ) : (
              <div key={index} className="home__action-card home__action-card--disabled">
                {action}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
