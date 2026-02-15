/**
 * Notification Service
 *
 * Manages in-app notifications for users. Notifications are created by
 * various system events (story completion, call processing, trial expiry)
 * and retrieved by users via the API.
 *
 * Notifications can target:
 *   - A specific user (userId set)
 *   - All users in an org (userId = null, broadcast)
 *
 * Future extensions:
 *   - Email delivery via SendGrid/SES
 *   - Slack/Teams webhooks
 *   - Push notifications
 */

import type { PrismaClient, NotificationType } from "@prisma/client";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CreateNotificationInput {
  organizationId: string;
  userId?: string | null;
  type: NotificationType;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
}

export interface NotificationListResult {
  notifications: Array<{
    id: string;
    type: NotificationType;
    title: string;
    body: string;
    metadata: unknown;
    read: boolean;
    createdAt: Date;
  }>;
  unreadCount: number;
  total: number;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class NotificationService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Creates a notification record.
   */
  async create(input: CreateNotificationInput): Promise<{ id: string }> {
    const notification = await this.prisma.notification.create({
      data: {
        organizationId: input.organizationId,
        userId: input.userId ?? null,
        type: input.type,
        title: input.title,
        body: input.body,
        metadata: input.metadata ? JSON.parse(JSON.stringify(input.metadata)) : undefined,
      },
    });
    return { id: notification.id };
  }

  /**
   * Lists notifications for a user (including org-wide broadcasts).
   * Returns newest first, with optional pagination.
   */
  async listForUser(
    organizationId: string,
    userId: string,
    options?: { limit?: number; offset?: number; unreadOnly?: boolean }
  ): Promise<NotificationListResult> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const where = {
      organizationId,
      OR: [{ userId }, { userId: null }],
      ...(options?.unreadOnly ? { read: false } : {}),
    };

    const [notifications, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({
        where: {
          organizationId,
          OR: [{ userId }, { userId: null }],
          read: false,
        },
      }),
    ]);

    return {
      notifications: notifications.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        metadata: n.metadata,
        read: n.read,
        createdAt: n.createdAt,
      })),
      unreadCount,
      total,
    };
  }

  /**
   * Marks a single notification as read.
   */
  async markAsRead(notificationId: string, userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: {
        id: notificationId,
        OR: [{ userId }, { userId: null }],
      },
      data: { read: true },
    });
  }

  /**
   * Marks all notifications as read for a user in an org.
   */
  async markAllAsRead(
    organizationId: string,
    userId: string
  ): Promise<{ count: number }> {
    const result = await this.prisma.notification.updateMany({
      where: {
        organizationId,
        OR: [{ userId }, { userId: null }],
        read: false,
      },
      data: { read: true },
    });
    return { count: result.count };
  }

  /**
   * Returns the count of unread notifications.
   */
  async getUnreadCount(
    organizationId: string,
    userId: string
  ): Promise<number> {
    return this.prisma.notification.count({
      where: {
        organizationId,
        OR: [{ userId }, { userId: null }],
        read: false,
      },
    });
  }

  // ─── Convenience Methods for Common Events ──────────────────────────

  /**
   * Notify when a story has finished generating.
   */
  async notifyStoryCompleted(
    organizationId: string,
    userId: string,
    storyId: string,
    storyTitle: string
  ): Promise<void> {
    await this.create({
      organizationId,
      userId,
      type: "STORY_COMPLETED",
      title: "Story ready",
      body: `Your case study "${storyTitle}" has been generated and is ready for review.`,
      metadata: { storyId },
    });
  }

  /**
   * Notify when a call recording has been fully processed.
   */
  async notifyCallProcessed(
    organizationId: string,
    callId: string
  ): Promise<void> {
    await this.create({
      organizationId,
      userId: null,
      type: "CALL_PROCESSED",
      title: "Call processed",
      body: `A new call recording has been processed, tagged, and indexed.`,
      metadata: { callId },
    });
  }

  /**
   * Notify when call processing fails.
   */
  async notifyCallProcessingFailed(
    organizationId: string,
    callId: string,
    errorMessage: string
  ): Promise<void> {
    await this.create({
      organizationId,
      userId: null,
      type: "CALL_PROCESSING_FAILED",
      title: "Call processing failed",
      body: `A call recording failed to process: ${errorMessage}`,
      metadata: { callId, error: errorMessage },
    });
  }

  /**
   * Notify when the org's trial is about to expire.
   */
  async notifyTrialExpiring(
    organizationId: string,
    daysRemaining: number
  ): Promise<void> {
    await this.create({
      organizationId,
      userId: null,
      type: "TRIAL_EXPIRING",
      title: "Trial expiring soon",
      body: `Your free trial expires in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}. Upgrade to keep access to all features.`,
      metadata: { daysRemaining },
    });
  }

  /**
   * Notify when a landing page is published.
   */
  async notifyPagePublished(
    organizationId: string,
    pageId: string,
    pageTitle: string,
    publishedByUserId: string
  ): Promise<void> {
    await this.create({
      organizationId,
      userId: null,
      type: "PAGE_PUBLISHED",
      title: "Landing page published",
      body: `The landing page "${pageTitle}" has been published.`,
      metadata: { pageId, publishedByUserId },
    });
  }

  /**
   * Notify approvers when a landing page needs approval.
   */
  async notifyPageNeedsApproval(
    organizationId: string,
    pageId: string,
    pageTitle: string,
    submittedByUserId: string
  ): Promise<void> {
    await this.create({
      organizationId,
      userId: null,
      type: "PAGE_NEEDS_APPROVAL",
      title: "Landing page needs approval",
      body: `The landing page "${pageTitle}" has been submitted for approval before publishing.`,
      metadata: { pageId, submittedByUserId },
    });
  }
}
