/**
 * Organization Settings Routes
 *
 * Provides admin endpoints for managing:
 *   - Organization name
 *   - Member list with roles
 *   - Invite flow (create invite, list pending, revoke)
 *   - Role updates and member removal
 */

import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { z } from "zod";
import type { PrismaClient, UserRole } from "@prisma/client";
import { Resend } from "resend";
import { requirePermission } from "../middleware/permissions.js";
import { buildPublicAppUrl } from "../lib/public-app-url.js";
import { OrgSettingsService } from "../services/org-settings.js";
import type { OrgRequest } from "../types/authenticated-request.js";
import { asyncHandler } from "../lib/async-handler.js";
import logger from "../lib/logger.js";
import { sendSuccess, sendCreated, sendBadRequest, sendUnauthorized, sendForbidden, sendNotFound, sendConflict } from "./_shared/responses.js";

// ─── Validation ──────────────────────────────────────────────────────────────

const UpdateOrgNameSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
});

const InviteMemberSchema = z.object({
  email: z.string().email("Valid email required"),
  role: z.enum(["ADMIN", "MEMBER", "VIEWER"]).default("MEMBER"),
});

const UpdateMemberRoleSchema = z.object({
  role: z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"]),
});

type AuthReq = OrgRequest;

function renderInviteEmailHtml(options: {
  orgName: string;
  role: UserRole;
  inviteUrl: string;
  inviterName: string | null;
}): string {
  const inviterText = options.inviterName
    ? `${options.inviterName} invited you`
    : "You were invited";

  return `<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; background: #f8f9fb; color: #1a1a2e; padding: 24px;">
  <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px;">
    <h1 style="margin: 0 0 12px; font-size: 22px;">Join ${options.orgName} on StoryEngine</h1>
    <p style="margin: 0 0 16px;">${inviterText} to join as <strong>${options.role}</strong>.</p>
    <p style="margin: 0 0 20px;">Use the button below to set your password and activate your account.</p>
    <a href="${options.inviteUrl}" style="display: inline-block; background: #4f46e5; color: #ffffff; text-decoration: none; padding: 10px 16px; border-radius: 8px; font-weight: 600;">Accept Invite</a>
    <p style="margin: 20px 0 0; color: #555770; font-size: 13px;">If the button does not work, paste this link into your browser:</p>
    <p style="margin: 6px 0 0; font-size: 13px; word-break: break-word;"><a href="${options.inviteUrl}">${options.inviteUrl}</a></p>
  </div>
</body>
</html>`;
}

// ─── Route Factory ───────────────────────────────────────────────────────────

export function createOrgSettingsRoutes(prisma: PrismaClient): Router {
  const router = Router();
  const orgSettings = new OrgSettingsService(prisma);
  const resendApiKey = process.env.RESEND_API_KEY ?? "";
  const resend = resendApiKey ? new Resend(resendApiKey) : null;
  const inviteFromAddress =
    process.env.INVITE_FROM_EMAIL ??
    process.env.STORY_REGEN_FROM_EMAIL ??
    "StoryEngine <noreply@storyengine.io>";

  // ── Get Organization Details ─────────────────────────────────────────

  /**
   * GET /api/settings/org
   *
   * Returns the organization name, plan, and member count.
   */
  router.get(
    "/",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        sendUnauthorized(res, "Authentication required");
        return;
      }

      const org = await orgSettings.getOrgDetails(req.organizationId);

      if (!org) {
        sendNotFound(res, "Organization not found");
        return;
      }

      sendSuccess(res, {
        organization: {
          id: org.id,
          name: org.name,
          plan: org.plan,
          member_count: org.memberCount,
          created_at: org.createdAt,
        },
      });
    })
  );

  // ── Anonymization Setting ────────────────────────────────────────────

  /**
   * GET /api/settings/org/anonymization
   *
   * Returns the current anonymization setting for the org.
   */
  router.get(
    "/anonymization",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        sendUnauthorized(res, "Authentication required");
        return;
      }

      const enabled = await orgSettings.getAnonymizationSetting(req.organizationId);

      sendSuccess(res, {
        anonymization_enabled: enabled,
      });
    })
  );

  /**
   * PATCH /api/settings/org/anonymization
   *
   * Toggles anonymization on or off for the entire org.
   * When disabled, published pages serve original content with real
   * company names. When re-enabled, pages revert to scrubbed content.
   * Admin/Owner only.
   */
  router.patch(
    "/anonymization",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        sendUnauthorized(res, "Authentication required");
        return;
      }

      const schema = z.object({ enabled: z.boolean() });
      const parse = schema.safeParse(req.body);
      if (!parse.success) {
        sendBadRequest(res, "validation_error", parse.error.issues);
        return;
      }

      await orgSettings.setAnonymizationSetting(req.organizationId, parse.data.enabled);

      sendSuccess(res, {
        updated: true,
        anonymization_enabled: parse.data.enabled,
      });
    })
  );

  // ── Update Organization Name ─────────────────────────────────────────

  /**
   * PATCH /api/settings/org
   *
   * Updates the organization name. Admin only.
   */
  router.patch(
    "/",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthReq, res: Response) => {
      const parse = UpdateOrgNameSchema.safeParse(req.body);
      if (!parse.success) {
        sendBadRequest(res, "validation_error", parse.error.issues);
        return;
      }

      await orgSettings.updateOrgName(req.organizationId, parse.data.name);

      sendSuccess(res, { updated: true });
    })
  );

  // ── List Members ─────────────────────────────────────────────────────

  /**
   * GET /api/settings/org/members
   *
   * Returns all members of the organization with their roles.
   */
  router.get(
    "/members",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthReq, res: Response) => {
      const members = await orgSettings.listMembers(req.organizationId);

      sendSuccess(res, { members });
    })
  );

  // ── Update Member Role ───────────────────────────────────────────────

  /**
   * PATCH /api/settings/org/members/:memberId/role
   *
   * Changes a member's role. Only OWNER can promote to OWNER or demote an OWNER.
   */
  router.patch(
    "/members/:memberId/role",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthReq, res: Response) => {
      const parse = UpdateMemberRoleSchema.safeParse(req.body);
      if (!parse.success) {
        sendBadRequest(res, "validation_error", parse.error.issues);
        return;
      }

      const memberId = req.params.memberId as string;
      const newRole = parse.data.role as UserRole;

      const targetUser = await orgSettings.findMember(memberId, req.organizationId);

      if (!targetUser) {
        sendNotFound(res, "Member not found");
        return;
      }

      if (
        (newRole === "OWNER" || targetUser.role === "OWNER") &&
        req.userRole !== "OWNER"
      ) {
        sendForbidden(res, "Only owners can assign or revoke the OWNER role.");
        return;
      }

      if (targetUser.role === "OWNER" && newRole !== "OWNER") {
        const ownerCount = await orgSettings.countOwners(req.organizationId);
        if (ownerCount <= 1) {
          sendBadRequest(res, "Cannot remove the last owner. Transfer ownership first.");
          return;
        }
      }

      await orgSettings.updateMemberRole(memberId, newRole);

      sendSuccess(res, { updated: true, role: newRole });
    })
  );

  // ── Remove Member ────────────────────────────────────────────────────

  /**
   * DELETE /api/settings/org/members/:memberId
   *
   * Removes a member from the organization.
   */
  router.delete(
    "/members/:memberId",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthReq, res: Response) => {
      const memberId = req.params.memberId as string;

      const targetUser = await orgSettings.findMember(memberId, req.organizationId);

      if (!targetUser) {
        sendNotFound(res, "Member not found");
        return;
      }

      if (memberId === req.userId) {
        sendBadRequest(res, "You cannot remove yourself from the organization.");
        return;
      }

      if (targetUser.role === "OWNER") {
        const ownerCount = await orgSettings.countOwners(req.organizationId);
        if (ownerCount <= 1) {
          sendBadRequest(res, "Cannot remove the last owner.");
          return;
        }
      }

      await orgSettings.removeMember(memberId);
      sendSuccess(res, { removed: true });
    })
  );

  // ── Invite Member ────────────────────────────────────────────────────

  /**
   * POST /api/settings/org/invites
   *
   * Creates an invite for a new member. Generates a unique token.
   * In production, this would trigger an email via WorkOS or a transactional
   * email service.
   */
  router.post(
    "/invites",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthReq, res: Response) => {
      const parse = InviteMemberSchema.safeParse(req.body);
      if (!parse.success) {
        sendBadRequest(res, "validation_error", parse.error.issues);
        return;
      }

      const existingUser = await orgSettings.findExistingUserByEmail(
          parse.data.email,
          req.organizationId
        );

        if (existingUser) {
          sendConflict(res, "This email is already a member of the organization.");
          return;
        }

        const token = crypto.randomBytes(32).toString("hex");
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

        const invite = await orgSettings.upsertInvite({
          organizationId: req.organizationId,
          email: parse.data.email,
          role: parse.data.role as UserRole,
          invitedById: req.userId,
          token,
          expiresAt,
        });

        const inviteUrl = buildPublicAppUrl(`/invite/${token}`);
        let emailSent = false;
        let emailDeliveryError: string | null = null;

        if (resend) {
          try {
            const { org, inviter } = await orgSettings.getOrgAndInviter(
              req.organizationId,
              req.userId
            );

            await resend.emails.send({
              from: inviteFromAddress,
              to: [invite.email],
              subject: `You're invited to ${org?.name ?? "StoryEngine"}`,
              html: renderInviteEmailHtml({
                orgName: org?.name ?? "StoryEngine",
                role: invite.role,
                inviteUrl,
                inviterName: inviter?.name ?? inviter?.email ?? null,
              }),
            });
            emailSent = true;
          } catch (sendErr) {
            emailDeliveryError =
              sendErr instanceof Error ? sendErr.message : "email_delivery_failed";
            logger.error("Invite email delivery error", { error: sendErr });
          }
        }

        sendCreated(res, {
          invite: {
            id: invite.id,
            email: invite.email,
            role: invite.role,
            invite_url: inviteUrl,
            expires_at: invite.expiresAt,
          },
          email_sent: emailSent,
          email_delivery_error: emailDeliveryError,
        });
    })
  );

  // ── List Pending Invites ─────────────────────────────────────────────

  /**
   * GET /api/settings/org/invites
   *
   * Returns all pending (not yet accepted) invites for the org.
   */
  router.get(
    "/invites",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthReq, res: Response) => {
      const invites = await orgSettings.listPendingInvites(req.organizationId);

      sendSuccess(res, {
        invites: invites.map((inv) => ({
          ...inv,
          expired: new Date() > inv.expiresAt,
        })),
      });
    })
  );

  // ── Revoke Invite ────────────────────────────────────────────────────

  /**
   * DELETE /api/settings/org/invites/:inviteId
   *
   * Revokes a pending invite.
   */
  router.delete(
    "/invites/:inviteId",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthReq, res: Response) => {
      const invite = await orgSettings.findInvite(
        req.params.inviteId as string,
        req.organizationId
      );

      if (!invite) {
        sendNotFound(res, "Invite not found");
        return;
      }

      await orgSettings.deleteInvite(invite.id);
      sendSuccess(res, { revoked: true });
    })
  );

  return router;
}
