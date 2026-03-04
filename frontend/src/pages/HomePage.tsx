/**
 * HomePage — Layout shell with data fetching.
 * Sub-components decomposed into ./home/
 */

import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { request } from "../lib/api/http";
import {
  getCustomerSuccessHealth,
  getRenewalValueReport,
  getStoryLibrary,
  type StoryLibraryItem,
  type CustomerSuccessHealth,
  type RenewalValueReport,
  type RoleAwareHome,
} from "../lib/api";
import { StatsGrid } from "./home/StatsGrid";
import { QuickActions } from "./home/QuickActions";
import { RecentActivity } from "./home/RecentActivity";
import { RenewalValue } from "./home/RenewalValue";

// Re-export sub-components for backward compatibility
export { StatsGrid } from "./home/StatsGrid";
export { QuickActions, mapActionToLink, getGreeting } from "./home/QuickActions";
export { RecentActivity } from "./home/RecentActivity";
export { RenewalValue } from "./home/RenewalValue";

/** Data returned by the `/dashboard/home` endpoint. */
type DashboardData = RoleAwareHome;

export function HomePage() {
  const {
    data: dashboardData,
    isLoading: dashLoading,
    error: dashError,
  } = useQuery<DashboardData>({
    queryKey: ["dashboard", "home"],
    queryFn: () => request<DashboardData>("/dashboard/home"),
  });

  const {
    data: stories,
    isLoading: storiesLoading,
  } = useQuery<StoryLibraryItem[]>({
    queryKey: ["stories", "recent"],
    queryFn: async () => {
      const res = await getStoryLibrary({ limit: 5 });
      return res.stories;
    },
  });

  const {
    data: csHealth,
    isLoading: csLoading,
  } = useQuery<CustomerSuccessHealth | null>({
    queryKey: ["cs", "health"],
    queryFn: async () => {
      try {
        return await getCustomerSuccessHealth();
      } catch {
        return null;
      }
    },
  });

  const {
    data: renewalReport,
    isLoading: renewalLoading,
  } = useQuery<RenewalValueReport | null>({
    queryKey: ["renewal", "report"],
    queryFn: async () => {
      try {
        return await getRenewalValueReport();
      } catch {
        return null;
      }
    },
  });

  if (dashLoading) {
    return (
      <div className="home__loading" role="status" aria-live="polite">
        Loading dashboard...
      </div>
    );
  }

  if (dashError || !dashboardData) {
    return (
      <div className="home__error" role="alert">
        <p>Failed to load dashboard data.</p>
        <Link to="/" className="btn btn--primary">
          Retry
        </Link>
      </div>
    );
  }

  return (
    <div className="page home">
      <StatsGrid data={dashboardData} csHealth={csHealth ?? null} />
      <QuickActions data={dashboardData} />
      <RecentActivity stories={stories ?? []} loading={storiesLoading} />
      <RenewalValue report={renewalReport ?? null} loading={renewalLoading} />
    </div>
  );
}
