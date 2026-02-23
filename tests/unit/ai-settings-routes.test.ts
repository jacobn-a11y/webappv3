import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import { createAISettingsRoutes } from "../../src/api/ai-settings-routes.js";

function createApp(usageTrackerOverrides: Record<string, unknown> = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).organizationId = "org-test";
    (req as any).userId = "user-test";
    (req as any).userRole = "ADMIN";
    next();
  });

  const prisma = {} as any;
  const configService = {
    resolveUserAccess: vi.fn(),
    listOrgConfigs: vi.fn(),
    listAvailablePlatformModels: vi.fn(),
    ...{},
  } as any;

  const usageTracker = {
    getPendingNotifications: vi.fn().mockResolvedValue([]),
    acknowledgeNotification: vi.fn().mockResolvedValue(true),
    acknowledgeAllNotifications: vi.fn().mockResolvedValue(0),
    ...usageTrackerOverrides,
  } as any;

  app.use("/api/ai", createAISettingsRoutes(prisma, configService, usageTracker));
  return { app, usageTracker };
}

async function request(
  app: express.Express,
  method: "get" | "post",
  path: string,
  body?: Record<string, unknown>
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
        headers: { "Content-Type": "application/json" },
      };

      const req = http.request(options, (res: any) => {
        let data = "";
        res.on("data", (chunk: string) => (data += chunk));
        res.on("end", () => {
          server.close();
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        });
      });

      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  });
}

describe("AI Settings notification ownership checks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("scopes pending notifications by org and user", async () => {
    const { app, usageTracker } = createApp();

    const res = await request(app, "get", "/api/ai/notifications");

    expect(res.status).toBe(200);
    expect(usageTracker.getPendingNotifications).toHaveBeenCalledWith(
      "org-test",
      "user-test"
    );
  });

  it("returns 404 when acknowledge target is not owned by caller", async () => {
    const { app, usageTracker } = createApp({
      acknowledgeNotification: vi.fn().mockResolvedValue(false),
    });

    const res = await request(
      app,
      "post",
      "/api/ai/notifications/notif-other-user/acknowledge"
    );

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("notification_not_found");
    expect(usageTracker.acknowledgeNotification).toHaveBeenCalledWith(
      "org-test",
      "user-test",
      "notif-other-user"
    );
  });

  it("returns acknowledge count for acknowledge-all", async () => {
    const { app } = createApp({
      acknowledgeAllNotifications: vi.fn().mockResolvedValue(3),
    });

    const res = await request(
      app,
      "post",
      "/api/ai/notifications/acknowledge-all"
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ acknowledged: true, count: 3 });
  });
});
