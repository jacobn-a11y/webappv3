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
import { requirePermission } from "../middleware/permissions.js";

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

// ─── Route Factory ───────────────────────────────────────────────────────────

export function createOrgSettingsRoutes(prisma: PrismaClient): Router {
  const router = Router();

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

      const { memberId } = req.params;
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
      const { memberId } = req.params;

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

        // In production: send invite email here via WorkOS or SendGrid
        const inviteUrl = `${process.env.APP_URL}/invite/${token}`;

        res.status(201).json({
          invite: {
            id: invite.id,
            email: invite.email,
            role: invite.role,
            invite_url: inviteUrl,
            expires_at: invite.expiresAt,
          },
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
            id: req.params.inviteId,
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
