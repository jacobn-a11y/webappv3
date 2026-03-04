import type {
  FirstValueRecommendations,
  SetupMvpAccountRow,
  SetupMvpQuickstartStatus,
  SetupPlanCatalog,
  SetupStatus,
} from "./types";
import { request } from "./http";

export async function getSetupMvpQuickstartStatus(): Promise<SetupMvpQuickstartStatus> {
  return request<SetupMvpQuickstartStatus>("/setup/mvp/quickstart");
}

export async function saveSetupMvpQuickstartKeys(body: {
  gong_api_key: string;
  openai_api_key: string;
  gong_base_url?: string;
}): Promise<{ saved: boolean; status: SetupMvpQuickstartStatus }> {
  return request<{ saved: boolean; status: SetupMvpQuickstartStatus }>(
    "/setup/mvp/quickstart",
    {
      method: "POST",
      body: JSON.stringify(body),
    }
  );
}

export async function indexSetupMvpGongAccounts(body?: {
  refresh?: boolean;
  max_scan_calls?: number;
}): Promise<{
  generated_at: string;
  total_calls_indexed: number;
  total_accounts: number;
  accounts: SetupMvpAccountRow[];
  cached: boolean;
}> {
  return request<{
    generated_at: string;
    total_calls_indexed: number;
    total_accounts: number;
    accounts: SetupMvpAccountRow[];
    cached: boolean;
  }>("/setup/mvp/quickstart/gong/accounts/index", {
    method: "POST",
    body: JSON.stringify(body ?? {}),
  });
}

export async function saveSetupMvpGongAccountSelection(body: {
  account_names: string[];
  trigger_ingest?: boolean;
}): Promise<{
  saved: boolean;
  selected_account_names: string[];
  ingest_started: boolean;
  idempotency_key: string | null;
}> {
  return request<{
    saved: boolean;
    selected_account_names: string[];
    ingest_started: boolean;
    idempotency_key: string | null;
  }>("/setup/mvp/quickstart/gong/accounts/selection", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getSetupStatus(): Promise<SetupStatus> {
  return request<SetupStatus>("/setup/status");
}

export async function getSetupPlans(): Promise<SetupPlanCatalog> {
  return request<SetupPlanCatalog>("/setup/step/plan");
}

export async function selectSetupPlan(
  plan: "FREE_TRIAL" | "STARTER" | "PROFESSIONAL" | "ENTERPRISE"
): Promise<{
  completed: boolean;
  checkoutUrl: string | null;
  status: SetupStatus;
}> {
  return request<{ completed: boolean; checkoutUrl: string | null; status: SetupStatus }>(
    "/setup/step/plan",
    {
      method: "POST",
      body: JSON.stringify({ plan }),
    }
  );
}

export async function saveSetupOrgProfile(body: {
  company_overview?: string;
  products?: string[];
  target_personas?: string[];
  target_industries?: string[];
}): Promise<{ updated: boolean; status: SetupStatus }> {
  return request<{ updated: boolean; status: SetupStatus }>("/setup/step/org-profile", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function saveSetupGovernanceDefaults(body: {
  retention_days?: number;
  audit_log_retention_days?: number;
  legal_hold_enabled?: boolean;
  pii_export_enabled?: boolean;
  deletion_requires_approval?: boolean;
  allow_named_story_exports?: boolean;
  rto_target_minutes?: number;
  rpo_target_minutes?: number;
}): Promise<{ updated: boolean; status: SetupStatus }> {
  return request<{ updated: boolean; status: SetupStatus }>(
    "/setup/step/governance-defaults",
    {
      method: "POST",
      body: JSON.stringify(body),
    }
  );
}

export async function applySetupRolePresets(): Promise<{
  updated: boolean;
  status: SetupStatus;
}> {
  return request<{ updated: boolean; status: SetupStatus }>("/setup/step/role-presets", {
    method: "POST",
  });
}

export async function getFirstValueRecommendations(): Promise<FirstValueRecommendations> {
  return request<FirstValueRecommendations>("/setup/first-value/recommendations");
}
