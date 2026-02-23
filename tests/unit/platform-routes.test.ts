import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import { createPlatformRoutes } from "../../src/api/platform-routes.js";

function createMockPrisma(ownerEmailForUserId: string | null) {
  return {
    user: {
      findUnique: vi.fn().mockResolvedValue(
        ownerEmailForUserId ? { email: ownerEmailForUserId } : null
      ),
    },
    platformSettings: {
      findFirst: vi
        .fn()
        .mockResolvedValue({ supportAccountEmail: "support@example.com", supportAccountLabel: "Platform Support" }),
    },
  };
}

function createApp(prisma: any, userId?: string) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (userId) {
      (req as any).userId = userId;
    }
    next();
  });
  app.use("/api/platform", createPlatformRoutes(prisma));
  return app;
}

async function request(
  app: express.Express,
  method: "get",
  path: string
): Promise<{ status: number; body: any }> {
  return new Promise((resolve) => {
    const http = require("http");
    const server = app.listen(0, () => {
      const port = (server.address() as any).port;
      const options = {
        hostname: "127.0.0.1",
        port,
        path,
        method: method.toUpperCase(),
      };

      const req = http.request(options, (res: any) => {
        let data = "";
        res.on("data", (chunk: string) => (data += chunk));
        res.on("end", () => {
          server.close();
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        });
      });
      req.end();
    });
  });
}

describe("Platform owner route guard", () => {
  beforeEach(() => {
    process.env.PLATFORM_OWNER_EMAIL = "owner@example.com";
  });

  afterEach(() => {
    delete process.env.PLATFORM_OWNER_EMAIL;
  });

  it("allows access when session user email matches platform owner", async () => {
    const prisma = createMockPrisma("owner@example.com");
    const app = createApp(prisma, "usr-owner");

    const res = await request(app, "get", "/api/platform/settings");

    expect(res.status).toBe(200);
    expect(res.body.support_account_email).toBe("support@example.com");
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: "usr-owner" },
      select: { email: true },
    });
  });

  it("returns 403 for non-owner authenticated users", async () => {
    const prisma = createMockPrisma("not-owner@example.com");
    const app = createApp(prisma, "usr-member");

    const res = await request(app, "get", "/api/platform/settings");

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Platform owner access required");
  });

  it("returns 401 when no authenticated user context exists", async () => {
    const prisma = createMockPrisma(null);
    const app = createApp(prisma);

    const res = await request(app, "get", "/api/platform/settings");

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Authentication required");
  });
});
