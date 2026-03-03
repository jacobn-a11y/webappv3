import express, { type Request, type Response, type NextFunction } from "express";
import type { PrismaClient } from "@prisma/client";
import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { createSetupRoutes } from "../../src/api/setup-routes.js";
import { withRequestServer } from "../helpers/request-server.js";

function buildSetupApp(userRole: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER") {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { organizationId?: string }).organizationId = "org_test";
    (req as Request & { userRole?: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER" }).userRole =
      userRole;
    next();
  });

  app.use(
    "/api/setup",
    createSetupRoutes({} as PrismaClient, {} as Stripe)
  );
  return app;
}

describe("setup step admin gating", () => {
  it("rejects non-admin roles for advanced setup step endpoints", async () => {
    const app = buildSetupApp("MEMBER");

    await withRequestServer(app, async (request) => {
      const [planRes, recordingRes, crmRes] = await Promise.all([
        request.post("/api/setup/step/plan").send({ plan: "STARTER" }),
        request.post("/api/setup/step/recording-provider").send({}),
        request.post("/api/setup/step/crm").send({}),
      ]);

      expect(planRes.status).toBe(403);
      expect(recordingRes.status).toBe(403);
      expect(crmRes.status).toBe(403);
      expect(planRes.body.error).toBe("Admin access required");
    });
  });
});
