export interface PermissionUser {
  userId: string;
  userName: string | null;
  userEmail: string;
  role: string;
  permissions: string[];
  accessGrants?: PermissionAccessGrant[];
}

export interface PermissionAccessGrant {
  id: string;
  scopeType: string;
  account: { id: string; name: string; domain: string | null } | null;
  cachedAccountIds: string[];
  crmReportId: string | null;
  crmProvider: string | null;
  crmReportName: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
}

// ─── Role Profiles ─────────────────────────────────────────────────────────

export interface RoleProfile {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isPreset: boolean;
  permissions: string[];
  canAccessAnonymousStories: boolean;
  canGenerateAnonymousStories: boolean;
  canAccessNamedStories: boolean;
  canGenerateNamedStories: boolean;
  defaultAccountScopeType: string;
  defaultAccountIds: string[];
  maxTokensPerDay: number | null;
  maxTokensPerMonth: number | null;
  maxRequestsPerDay: number | null;
  maxRequestsPerMonth: number | null;
  maxStoriesPerMonth: number | null;
  assignments: Array<{
    userId: string;
    user: { name: string | null; email: string };
  }>;
}

export interface RoleAssignableUser {
  id: string;
  name: string | null;
  email: string;
  base_role: string;
  role_profile_id: string | null;
}

export interface UpsertRoleProfileRequest {
  key: string;
  name: string;
  description?: string;
  permissions: string[];
  can_access_anonymous_stories: boolean;
  can_generate_anonymous_stories: boolean;
  can_access_named_stories: boolean;
  can_generate_named_stories: boolean;
  default_account_scope_type: string;
  default_account_ids?: string[];
  max_tokens_per_day?: number | null;
  max_tokens_per_month?: number | null;
  max_requests_per_day?: number | null;
  max_requests_per_month?: number | null;
  max_stories_per_month?: number | null;
}
