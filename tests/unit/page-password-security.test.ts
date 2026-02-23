import { describe, it, expect, vi } from "vitest";
import { LandingPageEditor } from "../../src/services/landing-page-editor.js";
import {
  hashPagePassword,
  verifyPagePassword,
} from "../../src/lib/page-password.js";

describe("page password security", () => {
  it("hashes and verifies page passwords", () => {
    const plain = "secret1234";
    const stored = hashPagePassword(plain);

    expect(stored).not.toBe(plain);
    expect(verifyPagePassword(plain, stored)).toBe(true);
    expect(verifyPagePassword("wrong-password", stored)).toBe(false);
  });

  it("stores hashed password when publishing landing pages", async () => {
    const prisma = {
      landingPage: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "page-1",
          slug: "story-page",
          organizationId: "org-1",
          includeCompanyName: true,
          editableBody: "Body content",
          title: "Story title",
          subtitle: null,
          calloutBoxes: [],
          story: { accountId: "acct-1" },
        }),
        update: vi.fn().mockResolvedValue({}),
      },
    } as any;

    const editor = new LandingPageEditor(prisma);
    (editor as any).createArtifactVersion = vi.fn().mockResolvedValue(undefined);

    await editor.publish("page-1", {
      visibility: "SHARED_WITH_LINK",
      password: "secret1234",
      publishedByUserId: "usr-1",
    });

    const updateArg = prisma.landingPage.update.mock.calls[0][0];
    const storedPassword = updateArg.data.password as string;

    expect(typeof storedPassword).toBe("string");
    expect(storedPassword).not.toBe("secret1234");
    expect(verifyPagePassword("secret1234", storedPassword)).toBe(true);
  });
});
