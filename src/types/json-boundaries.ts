import { z } from "zod";
import type { Prisma } from "@prisma/client";

const JsonObjectSchema = z.record(z.unknown());

const optionalInt = (min: number, max: number) =>
  z.number().int().min(min).max(max).optional().catch(undefined);

const optionalBool = () => z.boolean().optional().catch(undefined);

const optionalStringArray = (maxItemLength: number) =>
  z.array(z.string().min(1).max(maxItemLength)).optional().catch(undefined);

const DataGovernancePolicySchema = z
  .object({
    retention_days: optionalInt(30, 3650),
    audit_log_retention_days: optionalInt(30, 3650),
    legal_hold_enabled: optionalBool(),
    pii_export_enabled: optionalBool(),
    deletion_requires_approval: optionalBool(),
    allow_named_story_exports: optionalBool(),
    rto_target_minutes: optionalInt(5, 60 * 24 * 14),
    rpo_target_minutes: optionalInt(5, 60 * 24 * 14),
    ai_retry_budget: optionalInt(1, 5),
    ai_spend_alert_daily_cents: optionalInt(500, Number.MAX_SAFE_INTEGER),
  })
  .passthrough();

const SecurityPolicySchema = z
  .object({
    enforce_mfa_for_admin_actions: optionalBool(),
    sso_enforced: optionalBool(),
    allowed_sso_domains: optionalStringArray(200),
    session_controls_enabled: optionalBool(),
    max_session_age_hours: optionalInt(1, 24 * 90),
    reauth_interval_minutes: optionalInt(5, 24 * 60),
    ip_allowlist_enabled: optionalBool(),
    ip_allowlist: optionalStringArray(80),
  })
  .passthrough();

const CalloutIconSchema = z
  .enum(["metric", "quote", "insight", "timeline", "warning", "success"])
  .optional();

const CalloutBoxSchema = z.object({
  title: z.string(),
  body: z.string(),
  icon: CalloutIconSchema,
});

export type DataGovernancePolicyBoundary = z.infer<typeof DataGovernancePolicySchema>;
export type SecurityPolicyBoundary = z.infer<typeof SecurityPolicySchema>;
export type CalloutBoxBoundary = z.infer<typeof CalloutBoxSchema>;

export function decodeJsonObject(value: unknown): Record<string, unknown> {
  const parsed = JsonObjectSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

export function decodeDataGovernancePolicy(
  value: unknown
): DataGovernancePolicyBoundary {
  return DataGovernancePolicySchema.parse(decodeJsonObject(value));
}

export function decodeSecurityPolicy(value: unknown): SecurityPolicyBoundary {
  return SecurityPolicySchema.parse(decodeJsonObject(value));
}

export function decodeCredentials(value: unknown): Record<string, unknown> {
  return decodeJsonObject(value);
}

export function decodeRequestPayload(value: unknown): Record<string, unknown> {
  return decodeJsonObject(value);
}

export function decodeProvenance(value: unknown): Record<string, unknown> {
  return decodeJsonObject(value);
}

export function decodeCalloutBoxes(value: unknown): CalloutBoxBoundary[] {
  const parsed = z.array(CalloutBoxSchema).safeParse(value);
  return parsed.success ? parsed.data : [];
}

export function encodeJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value));
}
