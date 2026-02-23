import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createPlatformRoutes } from "./platform-routes.js";

function createPrisma(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      findUnique: vi.fn().mockResolvedValue({ email: "owner@example.com" }),
    },
    platformSettings: {
      findFirst: vi.fn().mockResolvedValue({
        id: "settings-1",
        supportAccountEmail: "support@example.com",
        supportAccountLabel: "Platform Support",
      }),
      update: vi.fn().mockResolvedValue({
        supportAccountEmail: "support@example.com",
        supportAccountLabel: "Platform Support",
      }),
      create: vi.fn().mockResolvedValue({
        supportAccountEmail: "support@example.com",
        supportAccountLabel: "Platform Support",
      }),
    },
    tenantDeletionRequest: {
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
    organization: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    story: { count: vi.fn().mockResolvedValue(0) },
    landingPage: { count: vi.fn().mockResolvedValue(0) },
    ...overrides,
  } as any;
}

function createApp(prisma: any, auth: { userId?: string } = { userId: "usr-owner" }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (auth.userId) (req as any).userId = auth.userId;
    next();
  });
  app.use("/api/platform", createPlatformRoutes(prisma));
  return app;
}

async function request(
  app: express.Express,
  method: "get" | "post",
  path: string
): Promise<{ status: number; body: any }> {
  return new Promise((resolve) => {
    const http = require("http");
    const server = app.listen(0, () => {
      const port = (server.address() as any).port;
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path,
          method: method.toUpperCase(),
        },
        (res: any) => {
          let data = "";
          res.on("data", (chunk: string) => (data += chunk));
          res.on("end", () => {
            server.close();
            resolve({
              status: res.statusCode,
              body: data ? JSON.parse(data) : {},
            });
          });
        }
      );
      req.end();
    });
  });
}

describe("platform routes", () => {
  beforeEach(() => {
    process.env.PLATFORM_OWNER_EMAIL = "owner@example.com";
  });

  afterEach(() => {
    delete process.env.PLATFORM_OWNER_EMAIL;
    vi.restoreAllMocks();
  });

  it("returns 500 when PLATFORM_OWNER_EMAIL is not configured", async () => {
    delete process.env.PLATFORM_OWNER_EMAIL;
    const app = createApp(createPrisma());

    const res = await request(app, "get", "/api/platform/settings");

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("PLATFORM_OWNER_EMAIL is not configured");
  });

  it("returns 404 when approving deletion without pending request", async () => {
    const prisma = createPrisma({
      tenantDeletionRequest: {
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    });
    const app = createApp(prisma);

    const res = await request(
      app,
      "post",
      "/api/platform/tenants/org-missing/deletion/approve"
    );

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("No pending deletion request found");
    expect(prisma.tenantDeletionRequest.update).not.toHaveBeenCalled();
  });

  it("approves deletion request and records approver", async () => {
    const prisma = createPrisma({
      tenantDeletionRequest: {
        findUnique: vi.fn().mockResolvedValue({
          id: "del-1",
          status: "PENDING_APPROVAL",
        }),
        update: vi.fn().mockResolvedValue({}),
      },
    });
    const app = createApp(prisma, { userId: "usr-owner" });

    const res = await request(
      app,
      "post",
      "/api/platform/tenants/org-1/deletion/approve"
    );

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(prisma.tenantDeletionRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "APPROVED",
          approvedById: "usr-owner",
        }),
      })
    );
  });
});
