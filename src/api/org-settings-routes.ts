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

interface AuthReq extends Request {
  organizationId?: string;
  userId?: string;
  userRole?: UserRole;
}

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
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      try {
        const org = await prisma.organization.findUnique({
          where: { id: req.organizationId },
          include: { _count: { select: { users: true } } },
        });

        if (!org) {
          res.status(404).json({ error: "Organization not found" });
          return;
        }

        res.json({
          organization: {
            id: org.id,
            name: org.name,
            plan: org.plan,
            member_count: org._count.users,
            created_at: org.createdAt,
          },
        });
      } catch (err) {
        console.error("Get org error:", err);
        res.status(500).json({ error: "Failed to load organization" });
      }
    }
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
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      try {
        const settings = await prisma.orgSettings.findUnique({
          where: { organizationId: req.organizationId },
          select: { anonymizationEnabled: true },
        });

        res.json({
          anonymization_enabled: settings?.anonymizationEnabled ?? true,
        });
      } catch (err) {
        console.error("Get anonymization setting error:", err);
        res.status(500).json({ error: "Failed to load anonymization setting" });
      }
    }
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
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      const schema = z.object({ enabled: z.boolean() });
      const parse = schema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({ error: "validation_error", details: parse.error.issues });
        return;
      }

      try {
        await prisma.orgSettings.upsert({
          where: { organizationId: req.organizationId },
          create: {
            organizationId: req.organizationId,
            anonymizationEnabled: parse.data.enabled,
          },
          update: {
            anonymizationEnabled: parse.data.enabled,
          },
        });

        res.json({
          updated: true,
          anonymization_enabled: parse.data.enabled,
        });
      } catch (err) {
        console.error("Update anonymization setting error:", err);
        res.status(500).json({ error: "Failed to update anonymization setting" });
      }
    }
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
    async (req: AuthReq, res: Response) => {
      const parse = UpdateOrgNameSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({ error: "validation_error", details: parse.error.issues });
        return;
      }

      try {
        await prisma.organization.update({
          where: { id: req.organizationId! },
          data: { name: parse.data.name },
        });

        res.json({ updated: true });
      } catch (err) {
        console.error("Update org name error:", err);
        res.status(500).json({ error: "Failed to update organization name" });
      }
    }
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
    async (req: AuthReq, res: Response) => {
      try {
        const members = await prisma.user.findMany({
          where: { organizationId: req.organizationId! },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            createdAt: true,
          },
          orderBy: { createdAt: "asc" },
        });

        res.json({ members });
      } catch (err) {
        console.error("List members error:", err);
        res.status(500).json({ error: "Failed to load members" });
      }
    }
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
    async (req: AuthReq, res: Response) => {
      const parse = UpdateMemberRoleSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({ error: "validation_error", details: parse.error.issues });
        return;
      }

      const memberId = req.params.memberId as string;
      const newRole = parse.data.role as UserRole;

      try {
        // Verify target user belongs to this org
        const targetUser = await prisma.user.findFirst({
          where: { id: memberId, organizationId: req.organizationId! },
        });

        if (!targetUser) {
          res.status(404).json({ error: "Member not found" });
          return;
        }

        // Only OWNER can assign/revoke OWNER role
        if (
          (newRole === "OWNER" || targetUser.role === "OWNER") &&
          req.userRole !== "OWNER"
        ) {
          res.status(403).json({
            error: "permission_denied",
            message: "Only owners can assign or revoke the OWNER role.",
          });
          return;
        }

        // Prevent demoting the last OWNER
        if (targetUser.role === "OWNER" && newRole !== "OWNER") {
          const ownerCount = await prisma.user.count({
            where: { organizationId: req.organizationId!, role: "OWNER" },
          });
          if (ownerCount <= 1) {
            res.status(400).json({
              error: "last_owner",
              message: "Cannot remove the last owner. Transfer ownership first.",
            });
            return;
          }
        }

        await prisma.user.update({
          where: { id: memberId },
          data: { role: newRole },
        });

        res.json({ updated: true, role: newRole });
      } catch (err) {
        console.error("Update member role error:", err);
        res.status(500).json({ error: "Failed to update member role" });
      }
    }
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
    async (req: AuthReq, res: Response) => {
      const memberId = req.params.memberId as string;

      try {
        const targetUser = await prisma.user.findFirst({
          where: { id: memberId, organizationId: req.organizationId! },
        });

        if (!targetUser) {
          res.status(404).json({ error: "Member not found" });
          return;
        }

        // Cannot remove yourself
        if (memberId === req.userId) {
          res.status(400).json({
            error: "cannot_remove_self",
            message: "You cannot remove yourself from the organization.",
          });
          return;
        }

        // Cannot remove the last OWNER
        if (targetUser.role === "OWNER") {
          const ownerCount = await prisma.user.count({
            where: { organizationId: req.organizationId!, role: "OWNER" },
          });
          if (ownerCount <= 1) {
            res.status(400).json({
              error: "last_owner",
              message: "Cannot remove the last owner.",
            });
            return;
          }
        }

        await prisma.user.delete({ where: { id: memberId } });
        res.json({ removed: true });
      } catch (err) {
        console.error("Remove member error:", err);
        res.status(500).json({ error: "Failed to remove member" });
      }
    }
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
    async (req: AuthReq, res: Response) => {
      const parse = InviteMemberSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({ error: "validation_error", details: parse.error.issues });
        return;
      }

      try {
        // Check if user already exists in the org
        const existingUser = await prisma.user.findFirst({
          where: {
            email: parse.data.email,
            organizationId: req.organizationId!,
          },
        });

        if (existingUser) {
          res.status(409).json({
            error: "already_member",
            message: "This email is already a member of the organization.",
          });
          return;
        }

        const token = crypto.randomBytes(32).toString("hex");
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

        const invite = await prisma.orgInvite.upsert({
          where: {
            organizationId_email: {
              organizationId: req.organizationId!,
              email: parse.data.email,
            },
          },
          create: {
            organizationId: req.organizationId!,
            email: parse.data.email,
            role: parse.data.role as UserRole,
            invitedById: req.userId!,
            token,
            expiresAt,
          },
          update: {
            role: parse.data.role as UserRole,
            invitedById: req.userId!,
            token,
            expiresAt,
            acceptedAt: null,
          },
        });

        const inviteUrl = buildPublicAppUrl(`/invite/${token}`);
        let emailSent = false;
        let emailDeliveryError: string | null = null;

        if (resend) {
          try {
            const [org, inviter] = await Promise.all([
              prisma.organization.findUnique({
                where: { id: req.organizationId! },
                select: { name: true },
              }),
              prisma.user.findUnique({
                where: { id: req.userId! },
                select: { name: true, email: true },
              }),
            ]);

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
            console.error("Invite email delivery error:", sendErr);
          }
        }

        res.status(201).json({
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
      } catch (err) {
        console.error("Create invite error:", err);
        res.status(500).json({ error: "Failed to create invite" });
      }
    }
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
    async (req: AuthReq, res: Response) => {
      try {
        const invites = await prisma.orgInvite.findMany({
          where: {
            organizationId: req.organizationId!,
            acceptedAt: null,
          },
          select: {
            id: true,
            email: true,
            role: true,
            expiresAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
        });

        res.json({
          invites: invites.map((inv) => ({
            ...inv,
            expired: new Date() > inv.expiresAt,
          })),
        });
      } catch (err) {
        console.error("List invites error:", err);
        res.status(500).json({ error: "Failed to load invites" });
      }
    }
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
    async (req: AuthReq, res: Response) => {
      try {
        const invite = await prisma.orgInvite.findFirst({
          where: {
            id: req.params.inviteId as string,
            organizationId: req.organizationId!,
          },
        });

        if (!invite) {
          res.status(404).json({ error: "Invite not found" });
          return;
        }

        await prisma.orgInvite.delete({ where: { id: invite.id } });
        res.json({ revoked: true });
      } catch (err) {
        console.error("Revoke invite error:", err);
        res.status(500).json({ error: "Failed to revoke invite" });
      }
    }
  );

  return router;
}
