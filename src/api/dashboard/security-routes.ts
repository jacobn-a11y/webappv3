import { type Response, type Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { requirePermission } from "../../middleware/permissions.js";
import type { AuditLogService } from "../../services/audit-log.js";
import { decodeSecurityPolicy } from "../../types/json-boundaries.js";
import { parseRequestBody } from "../_shared/validators.js";
import crypto from "crypto";
import {
  OUTBOUND_WEBHOOK_EVENTS,
  deliverWebhookToSubscription,
  listOutboundWebhookSubscriptions,
  saveOutboundWebhookSubscriptions,
  type OutboundWebhookEventType,
  type OutboundWebhookSubscription,
} from "../../services/outbound-webhooks.js";
import type { AuthenticatedRequest } from "../../types/authenticated-request.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { sendSuccess, sendCreated, sendNotFound, sendNoContent } from "../_shared/responses.js";
import { assertSafeOutboundUrl, parseHostAllowlist, UrlPolicyError } from "../../lib/url-security.js";

const SecurityPolicySchema = z.object({
  enforce_mfa_for_admin_actions: z.boolean().optional(),
  sso_enforced: z.boolean().optional(),
  allowed_sso_domains: z.array(z.string().min(1).max(200)).optional(),
  session_controls_enabled: z.boolean().optional(),
  max_session_age_hours: z.number().int().min(1).max(24 * 90).optional(),
  reauth_interval_minutes: z.number().int().min(5).max(24 * 60).optional(),
  ip_allowlist_enabled: z.boolean().optional(),
  ip_allowlist: z.array(z.string().min(1).max(80)).optional(),
});

const UpsertIpAllowlistEntrySchema = z.object({
  cidr: z.string().min(1).max(120),
  label: z.string().max(120).optional(),
  enabled: z.boolean().optional(),
});

const UpdateIpAllowlistEntrySchema = z.object({
  cidr: z.string().min(1).max(120).optional(),
  label: z.string().max(120).nullable().optional(),
  enabled: z.boolean().optional(),
});

const OutboundWebhookSchema = z.object({
  url: z.string().url().max(2000),
  event_types: z
    .array(z.enum(OUTBOUND_WEBHOOK_EVENTS))
    .min(1)
    .max(20),
  enabled: z.boolean().optional(),
  secret: z.string().min(8).max(200).optional(),
});

interface RegisterSecurityRoutesOptions {
  router: Router;
  prisma: PrismaClient;
  auditLogs: AuditLogService;
}

export function registerSecurityRoutes({
  router,
  prisma,
  auditLogs,
}: RegisterSecurityRoutesOptions): void {
  const eventOptions = OUTBOUND_WEBHOOK_EVENTS as readonly OutboundWebhookEventType[];
  const outboundWebhookHostAllowlist = parseHostAllowlist(
    process.env.OUTBOUND_WEBHOOK_HOST_ALLOWLIST
  );

  // ── Admin: Security Policy ─────────────────────────────────────────

  router.get(
    "/security-policy",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {

      const settings = await prisma.orgSettings.findUnique({
      where: { organizationId: req.organizationId! },
      select: { securityPolicy: true },
      });
      const policy = decodeSecurityPolicy(settings?.securityPolicy);

      sendSuccess(res, {
      enforce_mfa_for_admin_actions:
        policy.enforce_mfa_for_admin_actions ?? false,
      sso_enforced: policy.sso_enforced ?? false,
      allowed_sso_domains: policy.allowed_sso_domains ?? [],
      session_controls_enabled: policy.session_controls_enabled ?? false,
      max_session_age_hours: policy.max_session_age_hours ?? 720,
      reauth_interval_minutes: policy.reauth_interval_minutes ?? 60,
      ip_allowlist_enabled: policy.ip_allowlist_enabled ?? false,
      ip_allowlist: policy.ip_allowlist ?? [],
      });
      
    }
  ));

  router.patch(
    "/security-policy",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const payload = parseRequestBody(SecurityPolicySchema, req.body, res);
      if (!payload) {
        return;
      }

      const d = payload;

      await prisma.orgSettings.upsert({
      where: { organizationId: req.organizationId! },
      create: {
        organizationId: req.organizationId!,
        securityPolicy: {
          enforce_mfa_for_admin_actions:
            d.enforce_mfa_for_admin_actions ?? false,
          sso_enforced: d.sso_enforced ?? false,
          allowed_sso_domains:
            (d.allowed_sso_domains ?? [])
              .map((v) => v.trim().toLowerCase())
              .filter(Boolean),
          session_controls_enabled: d.session_controls_enabled ?? false,
          max_session_age_hours: d.max_session_age_hours ?? 720,
          reauth_interval_minutes: d.reauth_interval_minutes ?? 60,
          ip_allowlist_enabled: d.ip_allowlist_enabled ?? false,
          ip_allowlist: d.ip_allowlist ?? [],
        },
      },
      update: {
        securityPolicy: {
          enforce_mfa_for_admin_actions:
            d.enforce_mfa_for_admin_actions ?? false,
          sso_enforced: d.sso_enforced ?? false,
          allowed_sso_domains:
            (d.allowed_sso_domains ?? [])
              .map((v) => v.trim().toLowerCase())
              .filter(Boolean),
          session_controls_enabled: d.session_controls_enabled ?? false,
          max_session_age_hours: d.max_session_age_hours ?? 720,
          reauth_interval_minutes: d.reauth_interval_minutes ?? 60,
          ip_allowlist_enabled: d.ip_allowlist_enabled ?? false,
          ip_allowlist: d.ip_allowlist ?? [],
        },
      },
      });
      await auditLogs.record({
      organizationId: req.organizationId!,
      actorUserId: req.userId!,
      category: "POLICY",
      action: "SECURITY_POLICY_UPDATED",
      targetType: "org_settings",
      targetId: req.organizationId!,
      severity: "CRITICAL",
      metadata: {
        enforce_mfa_for_admin_actions:
          d.enforce_mfa_for_admin_actions ?? false,
        sso_enforced: d.sso_enforced ?? false,
        allowed_sso_domains_count:
          (d.allowed_sso_domains ?? [])
            .map((v) => v.trim().toLowerCase())
            .filter(Boolean).length,
        session_controls_enabled: d.session_controls_enabled ?? false,
        max_session_age_hours: d.max_session_age_hours ?? 720,
        reauth_interval_minutes: d.reauth_interval_minutes ?? 60,
        ip_allowlist_enabled: d.ip_allowlist_enabled ?? false,
        ip_allowlist_count: d.ip_allowlist?.length ?? 0,
      },
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      });
      sendSuccess(res, { updated: true });
      
    }
  ));

  // ── Admin: Outbound Webhooks ───────────────────────────────────────

  router.get(
    "/security/outbound-webhooks",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {

      const subscriptions = await listOutboundWebhookSubscriptions(
      prisma,
      req.organizationId!
      );
      sendSuccess(res, {
      subscriptions,
      supported_events: eventOptions,
      });
      
    }
  ));

  router.post(
    "/security/outbound-webhooks",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const payload = parseRequestBody(OutboundWebhookSchema, req.body, res);
      if (!payload) {
        return;
      }

      const current = await listOutboundWebhookSubscriptions(
      prisma,
      req.organizationId!
      );
      try {
        await assertSafeOutboundUrl(payload.url, {
          allowHttp: process.env.NODE_ENV !== "production",
          allowHttps: true,
          denyPrivateNetworks: true,
          allowlistHosts: outboundWebhookHostAllowlist,
        });
      } catch (error) {
        const reason = error instanceof UrlPolicyError ? error.code : "invalid_url";
        res.status(400).json({
          error: "invalid_webhook_url",
          message: `Outbound webhook URL failed security policy: ${reason}`,
        });
        return;
      }
      const now = new Date().toISOString();
      const next: OutboundWebhookSubscription = {
      id: crypto.randomUUID(),
      url: payload.url,
      secret: payload.secret ?? crypto.randomBytes(24).toString("hex"),
      enabled: payload.enabled ?? true,
      event_types: payload.event_types,
      created_at: now,
      updated_at: now,
      };
      await saveOutboundWebhookSubscriptions(prisma, req.organizationId!, [
      ...current,
      next,
      ]);
      await auditLogs.record({
      organizationId: req.organizationId!,
      actorUserId: req.userId!,
      category: "POLICY",
      action: "OUTBOUND_WEBHOOK_CREATED",
      targetType: "outbound_webhook",
      targetId: next.id,
      severity: "WARN",
      metadata: {
        url: next.url,
        event_types: next.event_types,
        enabled: next.enabled,
      },
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      });
      sendCreated(res, { subscription: next });
      
    }
  ));

  router.delete(
    "/security/outbound-webhooks/:subscriptionId",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {

      const subscriptionId = String(req.params.subscriptionId);
      const current = await listOutboundWebhookSubscriptions(
      prisma,
      req.organizationId!
      );
      const next = current.filter((subscription) => subscription.id !== subscriptionId);
      if (next.length === current.length) {
      sendNotFound(res, "outbound_webhook_not_found");
      return;
      }
      await saveOutboundWebhookSubscriptions(prisma, req.organizationId!, next);
      await auditLogs.record({
      organizationId: req.organizationId!,
      actorUserId: req.userId!,
      category: "POLICY",
      action: "OUTBOUND_WEBHOOK_DELETED",
      targetType: "outbound_webhook",
      targetId: subscriptionId,
      severity: "WARN",
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      });
      sendNoContent(res);
      
    }
  ));

  router.post(
    "/security/outbound-webhooks/:subscriptionId/test",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {

      const subscriptionId = String(req.params.subscriptionId);
      const current = await listOutboundWebhookSubscriptions(
      prisma,
      req.organizationId!
      );
      const target = current.find((subscription) => subscription.id === subscriptionId);
      if (!target) {
      sendNotFound(res, "outbound_webhook_not_found");
      return;
      }
      const delivery = await deliverWebhookToSubscription(target, {
      event_id: crypto.randomUUID(),
      event_type: "webhook.test",
      occurred_at: new Date().toISOString(),
      payload: {
        organization_id: req.organizationId!,
        message: "StoryEngine outbound webhook test event",
      },
      });
      sendSuccess(res, { delivered: delivery.ok, status: delivery.status, error: delivery.error ?? null });
      
    }
  ));

  // ── Admin: IP Allowlist Entries ───────────────────────────────────

  router.get(
    "/security/ip-allowlist",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {

      const entries = await prisma.orgIpAllowlistEntry.findMany({
      where: { organizationId: req.organizationId! },
      orderBy: [{ enabled: "desc" }, { createdAt: "desc" }],
      });
      sendSuccess(res, {
      entries: entries.map((e) => ({
        id: e.id,
        cidr: e.cidr,
        label: e.label,
        enabled: e.enabled,
        created_at: e.createdAt.toISOString(),
        updated_at: e.updatedAt.toISOString(),
      })),
      });
      
    }
  ));

  router.post(
    "/security/ip-allowlist",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const payload = parseRequestBody(UpsertIpAllowlistEntrySchema, req.body, res);
      if (!payload) {
        return;
      }

      const entry = await prisma.orgIpAllowlistEntry.create({
      data: {
        organizationId: req.organizationId!,
        cidr: payload.cidr.trim(),
        label: payload.label?.trim() || null,
        enabled: payload.enabled ?? true,
      },
      });
      await auditLogs.record({
      organizationId: req.organizationId!,
      actorUserId: req.userId!,
      category: "POLICY",
      action: "IP_ALLOWLIST_ENTRY_CREATED",
      targetType: "org_ip_allowlist_entry",
      targetId: entry.id,
      severity: "CRITICAL",
      metadata: { cidr: entry.cidr, enabled: entry.enabled },
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      });
      sendCreated(res, {
      id: entry.id,
      cidr: entry.cidr,
      label: entry.label,
      enabled: entry.enabled,
      });
      
    }
  ));

  router.patch(
    "/security/ip-allowlist/:entryId",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const payload = parseRequestBody(UpdateIpAllowlistEntrySchema, req.body, res);
      if (!payload) {
        return;
      }

      const entryId = Array.isArray(req.params.entryId)
      ? (req.params.entryId[0] ?? "")
      : (req.params.entryId ?? "");
      const updated = await prisma.orgIpAllowlistEntry.updateMany({
      where: {
        id: entryId,
        organizationId: req.organizationId!,
      },
      data: {
        ...(payload.cidr !== undefined ? { cidr: payload.cidr.trim() } : {}),
        ...(payload.label !== undefined
          ? { label: payload.label ? payload.label.trim() : null }
          : {}),
        ...(payload.enabled !== undefined ? { enabled: payload.enabled } : {}),
      },
      });
      if (updated.count === 0) {
      sendNotFound(res, "allowlist_entry_not_found");
      return;
      }
      await auditLogs.record({
      organizationId: req.organizationId!,
      actorUserId: req.userId!,
      category: "POLICY",
      action: "IP_ALLOWLIST_ENTRY_UPDATED",
      targetType: "org_ip_allowlist_entry",
      targetId: entryId,
      severity: "CRITICAL",
      metadata: payload as Record<string, unknown>,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      });
      sendSuccess(res, { updated: true });
      
    }
  ));

  router.delete(
    "/security/ip-allowlist/:entryId",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {

      const entryId = Array.isArray(req.params.entryId)
      ? (req.params.entryId[0] ?? "")
      : (req.params.entryId ?? "");
      const deleted = await prisma.orgIpAllowlistEntry.deleteMany({
      where: {
        id: entryId,
        organizationId: req.organizationId!,
      },
      });
      if (deleted.count === 0) {
      sendNotFound(res, "allowlist_entry_not_found");
      return;
      }
      await auditLogs.record({
      organizationId: req.organizationId!,
      actorUserId: req.userId!,
      category: "POLICY",
      action: "IP_ALLOWLIST_ENTRY_DELETED",
      targetType: "org_ip_allowlist_entry",
      targetId: entryId,
      severity: "CRITICAL",
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      });
      sendSuccess(res, { deleted: true });
      
    }
  ));
}
