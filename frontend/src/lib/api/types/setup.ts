export interface SetupStatus {
  currentStep: string;
  completedAt: string | null;
  completionScore: number;
  missingPrompts: string[];
  firstValue: {
    storiesGenerated: number;
    pagesPublished: number;
    complete: boolean;
  };
  steps: {
    recording_provider: {
      complete: boolean;
      provider?: string | null;
      mergeLinkedAccountId?: string | null;
    };
    crm: {
      complete: boolean;
      provider?: string | null;
      mergeLinkedAccountId?: string | null;
    };
    account_sync: {
      complete: boolean;
      syncedAccountCount?: number;
      unresolvedCount?: number;
      reviewedAt?: string | null;
    };
    plan: { complete: boolean };
    permissions: {
      complete: boolean;
      configuredAt?: string | null;
    };
  };
}

export interface SetupPlanCatalog {
  billing_enabled: boolean;
  plans: Array<{
    id: "FREE_TRIAL" | "STARTER" | "PROFESSIONAL" | "ENTERPRISE";
    name: string;
    description: string;
    price: number | { amount: number; currency: string; interval: string } | null;
    features: string[];
  }>;
}

export interface SetupMvpAccountRow {
  name: string;
  count: number;
}

export interface SetupMvpQuickstartStatus {
  gong_configured: boolean;
  gong_base_url: string;
  gong_status: string;
  gong_last_sync_at: string | null;
  gong_last_error: string | null;
  openai_configured: boolean;
  selected_account_names: string[];
  account_index: {
    generated_at: string | null;
    total_calls_indexed: number;
    total_accounts: number;
    accounts: SetupMvpAccountRow[];
  };
}

export interface IntegrationSettingsRow {
  id: string;
  merge_account_id: string;
  integration: string;
  category: "CRM" | "RECORDING";
  status: "ACTIVE" | "PAUSED" | "ERROR" | "REVOKED" | string;
  last_synced_at: string | null;
  initial_sync_done: boolean;
  created_at: string;
}

export interface IntegrationSettingsListResponse {
  merge_configured: boolean;
  integrations: IntegrationSettingsRow[];
}

export interface IntegrationLinkTokenResponse {
  link_token: string;
  category: "crm" | "filestorage";
}

export interface IntegrationCompleteLinkResponse {
  integration: {
    id: string;
    merge_account_id: string;
    integration: string;
    category: "CRM" | "RECORDING";
    status: "ACTIVE" | "PAUSED" | "ERROR" | "REVOKED" | string;
  };
}
