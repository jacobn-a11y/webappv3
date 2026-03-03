/**
 * Notification API Routes
 *
 * Endpoints for listing, reading, and managing user notifications.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { NotificationService } from "../services/notification-service.js";
import type { AuthenticatedRequest } from "../types/authenticated-request.js";
import { asyncHandler } from "../lib/async-handler.js";
import logger from "../lib/logger.js";

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
  router.get("/", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
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
  }));

  /**
   * GET /api/notifications/unread-count
   *
   * Returns just the count of unread notifications (for badge display).
   */
  router.get(
    "/unread-count",
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const { organizationId, userId } = req;
      if (!organizationId || !userId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      const count = await notificationService.getUnreadCount(
        organizationId,
        userId
      );
      res.json({ unread_count: count });
    })
  );

  /**
   * POST /api/notifications/:id/read
   *
   * Marks a single notification as read.
   */
  router.post(
    "/:id/read",
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const { userId } = req;
      if (!userId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      const notificationId = req.params.id as string;
      await notificationService.markAsRead(notificationId, userId);
      res.json({ success: true });
    })
  );

  /**
   * POST /api/notifications/read-all
   *
   * Marks all notifications as read for the current user.
   */
  router.post(
    "/read-all",
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const { organizationId, userId } = req;
      if (!organizationId || !userId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      const result = await notificationService.markAllAsRead(
        organizationId,
        userId
      );
      res.json({ success: true, marked_read: result.count });
    })
  );

  return router;
}
