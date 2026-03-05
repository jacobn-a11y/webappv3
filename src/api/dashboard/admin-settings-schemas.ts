import { z } from "zod";
import { STORY_LENGTHS, STORY_OUTLINES, STORY_TYPES } from "../../types/story-generation.js";
import { STORY_FORMATS } from "../../types/taxonomy.js";

export const UpdateOrgSettingsSchema = z.object({
  landing_pages_enabled: z.boolean().optional(),
  default_page_visibility: z.enum(["PRIVATE", "SHARED_WITH_LINK"]).optional(),
  approval_policy: z
    .enum(["ALL_REQUIRED", "ANON_NO_APPROVAL", "NAMED_NO_APPROVAL", "ALL_NO_APPROVAL"])
    .optional(),
  require_approval_to_publish: z.boolean().optional(),
  allowed_publishers: z.array(z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"])).optional(),
  max_pages_per_user: z.number().int().min(1).nullable().optional(),
  company_name_replacements: z.record(z.string(), z.string()).optional(),
});

export const StoryContextSchema = z.object({
  company_overview: z.string().max(5000).optional(),
  products: z.array(z.string().min(1).max(200)).optional(),
  target_personas: z.array(z.string().min(1).max(120)).optional(),
  target_industries: z.array(z.string().min(1).max(120)).optional(),
  differentiators: z.array(z.string().min(1).max(400)).optional(),
  proof_points: z.array(z.string().min(1).max(400)).optional(),
  banned_claims: z.array(z.string().min(1).max(300)).optional(),
  writing_style_guide: z.string().max(4000).optional(),
  approved_terminology: z.array(z.string().min(1).max(80)).optional(),
  published_branding: z
    .object({
      brand_name: z.string().max(120).optional(),
      logo_url: z.string().url().max(2000).optional().or(z.literal("")),
      primary_color: z
        .string()
        .regex(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/)
        .optional()
        .or(z.literal("")),
      accent_color: z
        .string()
        .regex(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/)
        .optional()
        .or(z.literal("")),
      surface_color: z
        .string()
        .regex(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/)
        .optional()
        .or(z.literal("")),
    })
    .optional(),
  default_story_length: z.enum(STORY_LENGTHS).optional(),
  default_story_outline: z.enum(STORY_OUTLINES).optional(),
  default_story_format: z.enum(STORY_FORMATS).optional(),
  default_story_type: z.enum(STORY_TYPES).optional(),
});

export const DataGovernanceSchema = z.object({
  retention_days: z.number().int().min(30).max(3650).optional(),
  audit_log_retention_days: z.number().int().min(30).max(3650).optional(),
  legal_hold_enabled: z.boolean().optional(),
  pii_export_enabled: z.boolean().optional(),
  deletion_requires_approval: z.boolean().optional(),
  allow_named_story_exports: z.boolean().optional(),
  rto_target_minutes: z
    .number()
    .int()
    .min(5)
    .max(60 * 24 * 14)
    .optional(),
  rpo_target_minutes: z
    .number()
    .int()
    .min(5)
    .max(60 * 24 * 14)
    .optional(),
});

export const CreateDeletionRequestSchema = z.object({
  target_type: z.enum(["CALL", "STORY", "LANDING_PAGE"]),
  target_id: z.string().min(1),
  reason: z.string().min(3).max(1000).optional(),
});

export const ReviewDeletionRequestSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  review_notes: z.string().max(1000).optional(),
});

export type DeleteGovernedTarget = (
  organizationId: string,
  targetType: "CALL" | "STORY" | "LANDING_PAGE",
  targetId: string
) => Promise<boolean>;
