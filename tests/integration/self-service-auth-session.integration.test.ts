import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createAuthRoutes } from "../../src/api/auth-routes.js";
import { createSessionAuth } from "../../src/middleware/session-auth.js";
import { requireAuth } from "../../src/middleware/auth.js";

describe("self-service auth + session middleware", () => {
  it("issues a session token on signup and authorizes protected routes", async () => {
    const users = new Map<string, any>();
    let createdOrg: { id: string; name: string } | null = null;
    let sessionRow: any = null;

    const prisma = {
      user: {
        findUnique: vi.fn(async ({ where }: any) => {
          if (where.workosUserId) {
            for (const user of users.values()) {
              if (user.workosUserId === where.workosUserId) return user;
            }
            return null;
          }
          if (where.email) {
            return users.get(where.email) ?? null;
          }
          return null;
        }),
        create: vi.fn(async ({ data }: any) => {
          const user = {
            id: "usr_1",
            email: data.email,
            name: data.name ?? null,
            workosUserId: data.workosUserId,
            organizationId: data.organizationId,
            role: data.role,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          users.set(user.email, user);
          return user;
        }),
        update: vi.fn(async ({ where, data }: any) => {
          const existing = Array.from(users.values()).find((u) => u.id === where.id);
          if (!existing) throw new Error("missing user");
          const updated = { ...existing, ...data };
          users.set(updated.email, updated);
          return updated;
        }),
      },
      organization: {
        create: vi.fn(async ({ data }: any) => {
          createdOrg = { id: "org_1", name: data.name };
          return {
            id: "org_1",
            ...data,
          };
        }),
      },
      orgSettings: {
        findUnique: vi.fn(async () => null),
      },
      userSession: {
        create: vi.fn(async ({ data }: any) => {
          const user = users.get("alice@example.com");
          sessionRow = {
            id: "sess_1",
            organizationId: data.organizationId,
            userId: data.userId,
            sessionToken: data.sessionToken,
            expiresAt: data.expiresAt,
            revokedAt: null,
            user,
          };
          return sessionRow;
        }),
        findFirst: vi.fn(async ({ where }: any) => {
          if (!sessionRow) return null;
          if (sessionRow.sessionToken !== where.sessionToken) return null;
          if (sessionRow.revokedAt !== null) return null;
          return sessionRow;
        }),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    } as any;

    const workos = {
      userManagement: {
        getAuthorizationUrl: vi.fn(() => "https://example.com"),
        createUser: vi.fn(async () => ({
          id: "wos_1",
          email: "alice@example.com",
          firstName: "Alice",
          lastName: "Walker",
        })),
        authenticateWithPassword: vi.fn(async () => ({
          accessToken: "access_token",
          refreshToken: "refresh_token",
          user: {
            id: "wos_1",
            email: "alice@example.com",
            firstName: "Alice",
            lastName: "Walker",
          },
        })),
        authenticateWithCode: vi.fn(),
      },
    } as any;

    const app = express();
    app.use(express.json());
    app.use("/api/auth", createAuthRoutes(prisma, workos));
    app.use(createSessionAuth(prisma));
    app.use(requireAuth);
    app.get("/api/protected", (req, res) => {
      const authReq = req as any;
      res.json({
        organizationId: authReq.organizationId,
        userId: authReq.userId,
      });
    });

    const signup = await request(app).post("/api/auth/signup").send({
      email: "alice@example.com",
      password: "secret123",
      name: "Alice Walker",
      organizationName: "Acme Cloud",
    });

    expect(signup.status).toBe(201);
    expect(signup.body.user.email).toBe("alice@example.com");
    expect(signup.body.sessionToken).toBeTruthy();
    expect(createdOrg?.id).toBe("org_1");

    const protectedRes = await request(app)
      .get("/api/protected")
      .set("x-session-token", signup.body.sessionToken as string);

    expect(protectedRes.status).toBe(200);
    expect(protectedRes.body).toEqual({
      organizationId: "org_1",
      userId: "usr_1",
    });
  });

  it("accepts invite token and creates an authenticated session", async () => {
    const users = new Map<string, any>();
    const inviteRow = {
      id: "inv_1",
      organizationId: "org_1",
      email: "invitee@example.com",
      role: "MEMBER",
      token: "invite_token_abc",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      acceptedAt: null as Date | null,
    };
    let sessionRow: any = null;

    const prisma = {
      user: {
        findUnique: vi.fn(async ({ where }: any) => {
          if (where.workosUserId) {
            for (const user of users.values()) {
              if (user.workosUserId === where.workosUserId) return user;
            }
            return null;
          }
          if (where.email) return users.get(where.email) ?? null;
          return null;
        }),
        create: vi.fn(async ({ data }: any) => {
          const user = {
            id: "usr_invited",
            email: data.email,
            name: data.name ?? null,
            workosUserId: data.workosUserId,
            organizationId: data.organizationId,
            role: data.role,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          users.set(user.email, user);
          return user;
        }),
        update: vi.fn(async ({ where, data }: any) => {
          const existing = Array.from(users.values()).find((u) => u.id === where.id);
          if (!existing) throw new Error("missing user");
          const updated = { ...existing, ...data };
          users.set(updated.email, updated);
          return updated;
        }),
      },
      organization: {
        findUnique: vi.fn(async ({ where }: any) => {
          if (where.id === "org_1") return { id: "org_1", name: "Acme Cloud" };
          return null;
        }),
      },
      orgSettings: {
        findUnique: vi.fn(async () => null),
      },
      orgInvite: {
        findUnique: vi.fn(async ({ where }: any) => {
          if (where.token === inviteRow.token) return inviteRow;
          return null;
        }),
        update: vi.fn(async ({ where, data }: any) => {
          if (where.id !== inviteRow.id) throw new Error("invite not found");
          inviteRow.acceptedAt = data.acceptedAt;
          return inviteRow;
        }),
      },
      userSession: {
        create: vi.fn(async ({ data }: any) => {
          const user = users.get("invitee@example.com");
          sessionRow = {
            id: "sess_inv_1",
            organizationId: data.organizationId,
            userId: data.userId,
            sessionToken: data.sessionToken,
            expiresAt: data.expiresAt,
            revokedAt: null,
            user,
          };
          return sessionRow;
        }),
        findFirst: vi.fn(async ({ where }: any) => {
          if (!sessionRow) return null;
          if (where.sessionToken !== sessionRow.sessionToken) return null;
          return sessionRow;
        }),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    } as any;

    const workos = {
      userManagement: {
        getAuthorizationUrl: vi.fn(() => "https://example.com"),
        createUser: vi.fn(async () => ({
          id: "wos_inv_1",
          email: "invitee@example.com",
          firstName: "Invitee",
          lastName: "User",
        })),
        authenticateWithPassword: vi.fn(async () => ({
          accessToken: "access_token",
          refreshToken: "refresh_token",
          user: {
            id: "wos_inv_1",
            email: "invitee@example.com",
            firstName: "Invitee",
            lastName: "User",
          },
        })),
        authenticateWithCode: vi.fn(),
      },
    } as any;

    const app = express();
    app.use(express.json());
    app.use("/api/auth", createAuthRoutes(prisma, workos));
    app.use(createSessionAuth(prisma));
    app.use(requireAuth);
    app.get("/api/protected", (req, res) => {
      const authReq = req as any;
      res.json({
        organizationId: authReq.organizationId,
        userId: authReq.userId,
      });
    });

    const acceptRes = await request(app)
      .post(`/api/auth/invites/${inviteRow.token}/accept`)
      .send({ name: "Invitee User", password: "secret1234" });

    expect(acceptRes.status).toBe(201);
    expect(acceptRes.body.user.email).toBe("invitee@example.com");
    expect(inviteRow.acceptedAt).toBeTruthy();
    expect(acceptRes.body.sessionToken).toBeTruthy();

    const protectedRes = await request(app)
      .get("/api/protected")
      .set("x-session-token", acceptRes.body.sessionToken as string);

    expect(protectedRes.status).toBe(200);
    expect(protectedRes.body.organizationId).toBe("org_1");
    expect(protectedRes.body.userId).toBe("usr_invited");
  });
});
