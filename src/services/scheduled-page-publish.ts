import type { PageVisibility, PrismaClient } from "@prisma/client";
import { LandingPageEditor } from "./landing-page-editor.js";
import logger from "../lib/logger.js";

export interface ScheduledPagePublishJobData {
  pageId: string;
  organizationId: string;
  userId: string;
  publishAt: string;
  visibility: PageVisibility;
  password?: string;
  expiresAt?: string;
  releaseNotes?: string;
}

export class ScheduledPagePublishService {
  private editor: LandingPageEditor;

  constructor(private prisma: PrismaClient) {
    this.editor = new LandingPageEditor(prisma);
  }

  async run(job: ScheduledPagePublishJobData): Promise<{
    published: boolean;
    reason?: string;
    url?: string;
    slug?: string;
  }> {
    const page = await this.prisma.landingPage.findUnique({
      where: { id: job.pageId },
      select: { id: true, organizationId: true, status: true },
    });

    if (!page || page.organizationId !== job.organizationId) {
      logger.warn("Scheduled publish target not found", {
        pageId: job.pageId,
        organizationId: job.organizationId,
      });
      return { published: false, reason: "target_not_found" };
    }

    if (page.status === "PUBLISHED") {
      return { published: false, reason: "already_published" };
    }

    const result = await this.editor.publish(job.pageId, {
      visibility: job.visibility,
      password: job.password,
      expiresAt: job.expiresAt ? new Date(job.expiresAt) : undefined,
      publishedByUserId: job.userId,
      releaseNotes: job.releaseNotes,
      provenance: {
        publish_mode: "scheduled",
        scheduled_for: job.publishAt,
        scheduled_actor_user_id: job.userId,
      },
    });

    return {
      published: true,
      url: result.url,
      slug: result.slug,
    };
  }
}
