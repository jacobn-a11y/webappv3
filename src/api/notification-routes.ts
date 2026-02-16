/**
 * Notification API Routes
 *
 * Endpoints for listing, reading, and managing user notifications.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { NotificationService } from "../services/notification-service.js";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AuthenticatedRequest extends Request {
  organizationId?: string;
  userId?: string;
}

// ─── Validation ──────────────────────────────────────────────────────────────

const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  unread_only: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});

// ─── Route Factory ───────────────────────────────────────────────────────────

export function createNotificationRoutes(
  notificationService: NotificationService
): Router {
  const router = Router();

  /**
   * GET /api/notifications
   *
   * Lists notifications for the authenticated user.
   * Query params: limit, offset, unread_only
   */
  router.get("/", async (req: AuthenticatedRequest, res: Response) => {
    const { organizationId, userId } = req;
    if (!organizationId || !userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const parseResult = ListQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      res.status(400).json({
        error: "validation_error",
        details: parseResult.error.issues,
      });
      return;
    }

    const { limit, offset, unread_only } = parseResult.data;

    try {
      const result = await notificationService.listForUser(
        organizationId,
        userId,
        { limit, offset, unreadOnly: unread_only }
      );

      res.json({
        notifications: result.notifications.map((n) => ({
          id: n.id,
          type: n.type,
          title: n.title,
          body: n.body,
          metadata: n.metadata,
          read: n.read,
          created_at: n.createdAt.toISOString(),
        })),
        unread_count: result.unreadCount,
        total: result.total,
      });
    } catch (err) {
      console.error("Notification list error:", err);
      res.status(500).json({ error: "Failed to retrieve notifications" });
    }
  });

  /**
   * GET /api/notifications/unread-count
   *
   * Returns just the count of unread notifications (for badge display).
   */
  router.get(
    "/unread-count",
    async (req: AuthenticatedRequest, res: Response) => {
      const { organizationId, userId } = req;
      if (!organizationId || !userId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      try {
        const count = await notificationService.getUnreadCount(
          organizationId,
          userId
        );
        res.json({ unread_count: count });
      } catch (err) {
        console.error("Unread count error:", err);
        res.status(500).json({ error: "Failed to get unread count" });
      }
    }
  );

  /**
   * POST /api/notifications/:id/read
   *
   * Marks a single notification as read.
   */
  router.post(
    "/:id/read",
    async (req: AuthenticatedRequest, res: Response) => {
      const { userId } = req;
      if (!userId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      try {
        const notificationId = req.params.id as string;
        await notificationService.markAsRead(notificationId, userId);
        res.json({ success: true });
      } catch (err) {
        console.error("Mark read error:", err);
        res.status(500).json({ error: "Failed to mark notification as read" });
      }
    }
  );

  /**
   * POST /api/notifications/read-all
   *
   * Marks all notifications as read for the current user.
   */
  router.post(
    "/read-all",
    async (req: AuthenticatedRequest, res: Response) => {
      const { organizationId, userId } = req;
      if (!organizationId || !userId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      try {
        const result = await notificationService.markAllAsRead(
          organizationId,
          userId
        );
        res.json({ success: true, marked_read: result.count });
      } catch (err) {
        console.error("Mark all read error:", err);
        res
          .status(500)
          .json({ error: "Failed to mark notifications as read" });
      }
    }
  );

  return router;
}
