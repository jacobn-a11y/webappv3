import { beforeEach, describe, expect, it, vi } from "vitest";
import { PostPublishValidationService } from "./post-publish-validation.js";

function createMockPrisma() {
  return {
    landingPage: {
      findFirst: vi.fn(),
    },
    publishedArtifactVersion: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  };
}

describe("PostPublishValidationService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("persists PASS validation snapshot for reachable links", async () => {
    const prisma = createMockPrisma();
    prisma.landingPage.findFirst.mockResolvedValue({
      id: "page-1",
      organizationId: "org-1",
      title: "Title",
      subtitle: null,
      editableBody: "[site](https://example.com)",
      scrubbedBody: "",
      calloutBoxes: [],
      scrubbedCalloutBoxes: [],
    });
    prisma.publishedArtifactVersion.findFirst.mockResolvedValue({
      id: "ver-1",
      provenance: {},
    });
    prisma.publishedArtifactVersion.update.mockResolvedValue({});

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        status: 200,
      }))
    );

    const service = new PostPublishValidationService(prisma as any);
    const result = await service.runAndPersist({
      organizationId: "org-1",
      pageId: "page-1",
    });

    expect(result).not.toBeNull();
    expect(result?.status).toBe("PASS");
    expect(result?.broken_links).toHaveLength(0);
    expect(prisma.publishedArtifactVersion.update).toHaveBeenCalledTimes(1);
  });

  it("marks FAIL when malformed or unreachable links are present", async () => {
    const prisma = createMockPrisma();
    prisma.landingPage.findFirst.mockResolvedValue({
      id: "page-1",
      organizationId: "org-1",
      title: "Title",
      subtitle: null,
      editableBody: "[bad](javascript:alert(1)) and https://broken.example.test",
      scrubbedBody: "",
      calloutBoxes: [],
      scrubbedCalloutBoxes: [],
    });
    prisma.publishedArtifactVersion.findFirst.mockResolvedValue({
      id: "ver-1",
      provenance: {},
    });
    prisma.publishedArtifactVersion.update.mockResolvedValue({});

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        status: 503,
      }))
    );

    const service = new PostPublishValidationService(prisma as any);
    const result = await service.runAndPersist({
      organizationId: "org-1",
      pageId: "page-1",
    });

    expect(result?.status).toBe("FAIL");
    expect(result?.broken_links.length).toBeGreaterThan(0);
    expect(
      result?.broken_links.some((issue) =>
        issue.reason.toLowerCase().includes("unsafe")
      )
    ).toBe(true);
  });
});
