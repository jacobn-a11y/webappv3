import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createPublicPageRoutes } from "../../src/api/public-page-renderer.js";
import { LandingPageEditor } from "../../src/services/landing-page-editor.js";
import { hashPagePassword } from "../../src/lib/page-password.js";
import { withRequestServer } from "../helpers/request-server.js";

function buildProtectedPagePrisma(storedPassword: string) {
  return {
    landingPage: {
      findUnique: vi.fn().mockResolvedValue({
        status: "PUBLISHED",
        visibility: "SHARED_WITH_LINK",
        password: storedPassword,
        expiresAt: null,
      }),
    },
  } as any;
}

describe("public page password route hardening", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not accept password via URL query param", async () => {
    const storedPassword = hashPagePassword("secret1234");
    const prisma = buildProtectedPagePrisma(storedPassword);
    const getPublicSpy = vi
      .spyOn(LandingPageEditor.prototype, "getPublicBySlug")
      .mockResolvedValue(null);

    const app = express();
    app.use(express.json());
    app.use("/s", createPublicPageRoutes(prisma));

    const res = await withRequestServer(app, (req) =>
      req.get("/s/story-slug?p=secret1234").expect(200)
    );

    expect(res.text).toContain("This page is protected");
    expect(getPublicSpy).not.toHaveBeenCalled();
  });

  it("accepts password via POST body", async () => {
    const storedPassword = hashPagePassword("secret1234");
    const prisma = buildProtectedPagePrisma(storedPassword);
    const getPublicSpy = vi
      .spyOn(LandingPageEditor.prototype, "getPublicBySlug")
      .mockResolvedValue({
        title: "Public Story",
        subtitle: null,
        body: "Story content",
        calloutBoxes: [],
        totalCallHours: 2.5,
        heroImageUrl: null,
        customCss: null,
        publishedAt: new Date(),
      });

    const app = express();
    app.use(express.json());
    app.use("/s", createPublicPageRoutes(prisma));

    const res = await withRequestServer(app, (req) =>
      req.post("/s/story-slug").send({ p: "secret1234" }).expect(200)
    );

    expect(res.text).toContain("Compiled by AI from");
    expect(getPublicSpy).toHaveBeenCalledWith("story-slug", "secret1234");
  });
});
