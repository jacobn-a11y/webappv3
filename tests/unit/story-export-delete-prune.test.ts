import express from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withRequestServer } from "../helpers/request-server.js";
import { registerExportRoutes } from "../../src/api/story/export-routes.js";

describe("story delete vector pruning", () => {
  const baseStory = {
    id: "story-1",
    accountId: "acct-1",
    _count: { landingPages: 0 },
  };

  const makeApp = (deps: {
    roleProfiles: { getEffectivePolicy: ReturnType<typeof vi.fn> };
    storyQuery: {
      getStoryForDeletion: ReturnType<typeof vi.fn>;
      deleteStory: ReturnType<typeof vi.fn>;
      getStoryForExport: ReturnType<typeof vi.fn>;
    };
    accessService: { canAccessAccount: ReturnType<typeof vi.fn> };
    ragEngine?: { pruneVectorsForStory: ReturnType<typeof vi.fn> };
  }) => {
    const app = express();
    const router = express.Router();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).organizationId = "org-1";
      (req as any).userId = "user-1";
      (req as any).userRole = "OWNER";
      next();
    });
    registerExportRoutes({
      router,
      roleProfiles: deps.roleProfiles as any,
      storyQuery: deps.storyQuery as any,
      accessService: deps.accessService as any,
      ragEngine: deps.ragEngine as any,
    });
    app.use("/api/stories", router);
    return app;
  };

  let roleProfiles: { getEffectivePolicy: ReturnType<typeof vi.fn> };
  let storyQuery: {
    getStoryForDeletion: ReturnType<typeof vi.fn>;
    deleteStory: ReturnType<typeof vi.fn>;
    getStoryForExport: ReturnType<typeof vi.fn>;
  };
  let accessService: { canAccessAccount: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    roleProfiles = {
      getEffectivePolicy: vi.fn().mockResolvedValue({
        canGenerateAnonymousStories: true,
      }),
    };
    storyQuery = {
      getStoryForDeletion: vi.fn().mockResolvedValue(baseStory),
      deleteStory: vi.fn().mockResolvedValue(undefined),
      getStoryForExport: vi.fn(),
    };
    accessService = {
      canAccessAccount: vi.fn().mockResolvedValue(true),
    };
  });

  it("prunes story-linked vectors before delete when rag engine is provided", async () => {
    const ragEngine = {
      pruneVectorsForStory: vi.fn().mockResolvedValue(2),
    };
    const app = makeApp({ roleProfiles, storyQuery, accessService, ragEngine });

    await withRequestServer(app, (request) =>
      request.delete("/api/stories/story-1").expect(200)
    );

    expect(ragEngine.pruneVectorsForStory).toHaveBeenCalledWith({
      organizationId: "org-1",
      storyId: "story-1",
    });
    expect(storyQuery.deleteStory).toHaveBeenCalledWith("story-1");
  });

  it("still deletes story when rag engine is not provided", async () => {
    const app = makeApp({ roleProfiles, storyQuery, accessService });

    await withRequestServer(app, (request) =>
      request.delete("/api/stories/story-1").expect(200)
    );

    expect(storyQuery.deleteStory).toHaveBeenCalledWith("story-1");
  });
});
