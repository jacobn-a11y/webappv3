export interface PlatformSettings {
  support_account_email: string | null;
  support_account_label: string;
}

export interface TenantOverview {
  id: string;
  name: string;
  plan: string;
  user_count: number;
  story_count_30d: number;
  page_count_30d: number;
  created_at: string;
  support_opted_out: boolean;
  deletion_request: TenantDeletionRequestInfo | null;
}

export interface TenantDeletionRequestInfo {
  id: string;
  status: "PENDING_APPROVAL" | "APPROVED" | "CANCELLED" | "COMPLETED";
  reason: string | null;
  requested_by_email: string | null;
  scheduled_delete_at: string | null;
  created_at: string;
}

export interface SupportAccountInfo {
  email: string | null;
  label: string;
  opted_out: boolean;
}
