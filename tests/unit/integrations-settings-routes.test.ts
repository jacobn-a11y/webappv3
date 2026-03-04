import express from "express";
import request from "supertest";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createIntegrationsRoutes } from "../../src/api/integrations-routes.js";

type RoutePrisma = Parameters<typeof createIntegrationsRoutes>[0];
type RouteMergeClient = Parameters<typeof createIntegrationsRoutes>[1];
type AuthedRequest = express.Request & {
  userId?: string;
  userRole?: string;
  organizationId?: string;
};

function createApp(options?: {
  prismaOverrides?: Record<string, unknown>;
  mergeClientOverrides?: Record<string, unknown>;
}) {
  const prisma = {
    linkedAccount: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    organization: {
      findUnique: vi.fn().mockResolvedValue({
        id: "org-1",
        name: "Acme Corp",
      }),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({
        email: "owner@acme.com",
      }),
    },
    ...(options?.prismaOverrides ?? {}),
  } as unknown as RoutePrisma;

  const mergeClient = {
    exchangeLinkToken: vi.fn().mockResolvedValue({
      id: "la-1",
      mergeLinkedAccountId: "merge-linked-1",
      integrationSlug: "salesforce",
      category: "CRM",
      status: "ACTIVE",
    }),
    ...(options?.mergeClientOverrides ?? {}),
  } as unknown as RouteMergeClient;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const authReq = req as AuthedRequest;
    authReq.userId = "user-owner";
    authReq.userRole = "OWNER";
    authReq.organizationId = "org-1";
    next();
  });
  app.use("/api/settings/integrations", createIntegrationsRoutes(prisma, mergeClient));

  return { app, prisma, mergeClient };
}

describe("settings integrations routes", () => {
  beforeEach(() => {
    process.env.MERGE_API_KEY = "merge-test-key";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.MERGE_API_KEY;
  });

  it("creates a category-scoped Merge link token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ link_token: "link-token-123" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { app } = createApp();
    const response = await request(app)
      .post("/api/settings/integrations/link-token")
      .send({ category: "crm" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      link_token: "link-token-123",
      category: "crm",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const parsedBody = JSON.parse(String(init.body));
    expect(parsedBody.categories).toEqual(["crm"]);
    expect(parsedBody.end_user_origin_id).toBe("org-1");
    expect(parsedBody.end_user_organization_name).toBe("Acme Corp");
    expect(parsedBody.end_user_email_address).toBe("owner@acme.com");
  });

  it("rejects invalid link-token category", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { app } = createApp();
    const response = await request(app)
      .post("/api/settings/integrations/link-token")
      .send({ category: "invalid" });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("validation_error");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("completes link using merge client and returns linked account payload", async () => {
    const { app, mergeClient } = createApp({
      mergeClientOverrides: {
        exchangeLinkToken: vi.fn().mockResolvedValue({
          id: "la-2",
          mergeLinkedAccountId: "merge-linked-2",
          integrationSlug: "hubspot",
          category: "CRM",
          status: "ACTIVE",
        }),
      },
    });

    const response = await request(app)
      .post("/api/settings/integrations/complete-link")
      .send({ public_token: "public-token-123", category: "crm" });

    expect(response.status).toBe(201);
    expect(response.body.integration).toEqual({
      id: "la-2",
      merge_account_id: "merge-linked-2",
      integration: "hubspot",
      category: "CRM",
      status: "ACTIVE",
    });
    expect(mergeClient.exchangeLinkToken).toHaveBeenCalledWith(
      "org-1",
      "public-token-123"
    );
  });
});
