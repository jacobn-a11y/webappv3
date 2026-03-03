import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ScheduledPagePublishService } from "./scheduled-page-publish.js";
import { LandingPageEditor } from "./landing-page-editor.js";

describe("ScheduledPagePublishService", () => {
  const prisma = {
    landingPage: {
      findUnique: vi.fn(),
    },
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns target_not_found when page is missing", async () => {
    (prisma as any).landingPage.findUnique.mockResolvedValue(null);
    const service = new ScheduledPagePublishService(prisma as any);

    const result = await service.run({
      pageId: "page-1",
      organizationId: "org-1",
      userId: "user-1",
      publishAt: new Date("2026-03-03T16:00:00.000Z").toISOString(),
      visibility: "PRIVATE",
    });

    expect(result).toEqual({
      published: false,
      reason: "target_not_found",
    });
  });

  it("publishes when page is valid and not already published", async () => {
    (prisma as any).landingPage.findUnique.mockResolvedValue({
      id: "page-1",
      organizationId: "org-1",
      status: "DRAFT",
    });
    const publishSpy = vi
      .spyOn(LandingPageEditor.prototype, "publish")
      .mockResolvedValue({
        slug: "page-1-slug",
        url: "https://example.com/s/page-1-slug",
      });

    const service = new ScheduledPagePublishService(prisma as any);
    const result = await service.run({
      pageId: "page-1",
      organizationId: "org-1",
      userId: "user-1",
      publishAt: new Date("2026-03-03T16:00:00.000Z").toISOString(),
      visibility: "SHARED_WITH_LINK",
      password: "secret-1234",
      expiresAt: new Date("2026-03-10T16:00:00.000Z").toISOString(),
      releaseNotes: "Scheduled release",
    });

    expect(publishSpy).toHaveBeenCalledTimes(1);
    expect(publishSpy).toHaveBeenCalledWith("page-1", {
      visibility: "SHARED_WITH_LINK",
      password: "secret-1234",
      expiresAt: new Date("2026-03-10T16:00:00.000Z"),
      publishedByUserId: "user-1",
      releaseNotes: "Scheduled release",
      provenance: {
        publish_mode: "scheduled",
        scheduled_for: "2026-03-03T16:00:00.000Z",
        scheduled_actor_user_id: "user-1",
      },
    });
    expect(result).toEqual({
      published: true,
      url: "https://example.com/s/page-1-slug",
      slug: "page-1-slug",
    });
  });
});
