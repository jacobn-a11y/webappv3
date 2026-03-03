import { z } from "zod";

export const CompleteRecordingProviderSchema = z.object({
  provider: z.enum([
    "GONG",
    "CHORUS",
    "ZOOM",
    "GOOGLE_MEET",
    "TEAMS",
    "FIREFLIES",
    "DIALPAD",
    "AIRCALL",
    "RINGCENTRAL",
    "SALESLOFT",
    "OUTREACH",
    "OTHER",
  ]),
  merge_linked_account_id: z.string().min(1),
});

export const CompleteCrmSchema = z.object({
  crm_provider: z.enum(["SALESFORCE", "HUBSPOT"]),
  merge_linked_account_id: z.string().min(1),
});

export const EntityResolutionFixSchema = z.object({
  fixes: z.array(
    z.object({
      call_id: z.string().min(1),
      account_id: z.string().min(1),
    })
  ),
});

export const SelectPlanSchema = z.object({
  plan: z.enum(["FREE_TRIAL", "STARTER", "PROFESSIONAL", "ENTERPRISE"]),
});

export const PermissionsSchema = z.object({
  default_page_visibility: z.enum(["PRIVATE", "SHARED_WITH_LINK"]),
  allowed_publishers: z.array(z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"])),
  require_approval_to_publish: z.boolean(),
});

export const OrgProfileSchema = z.object({
  company_overview: z.string().max(5000).optional(),
  products: z.array(z.string().min(1).max(200)).optional(),
  target_personas: z.array(z.string().min(1).max(120)).optional(),
  target_industries: z.array(z.string().min(1).max(120)).optional(),
});

export const GovernanceDefaultsSchema = z.object({
  retention_days: z.number().int().min(30).max(3650).optional(),
  audit_log_retention_days: z.number().int().min(30).max(3650).optional(),
  legal_hold_enabled: z.boolean().optional(),
  pii_export_enabled: z.boolean().optional(),
  deletion_requires_approval: z.boolean().optional(),
  allow_named_story_exports: z.boolean().optional(),
  rto_target_minutes: z.number().int().min(5).max(60 * 24 * 14).optional(),
  rpo_target_minutes: z.number().int().min(5).max(60 * 24 * 14).optional(),
});

export const SkipStepSchema = z.object({
  step: z.enum(["RECORDING_PROVIDER", "CRM", "ACCOUNT_SYNC", "PLAN", "PERMISSIONS"]),
});

export const MvpQuickstartSaveSchema = z.object({
  gong_api_key: z.string().min(1, "Gong API key is required"),
  openai_api_key: z.string().min(1, "OpenAI API key is required"),
  gong_base_url: z.string().url().optional(),
});

export const MvpIndexAccountsSchema = z.object({
  refresh: z.boolean().optional(),
  max_scan_calls: z.number().int().min(0).max(200_000).optional(),
});

export const MvpSelectAccountsSchema = z.object({
  account_names: z.array(z.string().min(1)).max(500),
  trigger_ingest: z.boolean().optional(),
});
