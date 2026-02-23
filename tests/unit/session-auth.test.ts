import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { createSessionAuth } from "../../src/middleware/session-auth.js";
import { hashSessionToken } from "../../src/lib/session-token.js";

function mockReq(overrides: Record<string, unknown> = {}): Request {
  return {
    headers: {},
    ...overrides,
  } as unknown as Request;
}

function mockRes(): Response {
  return {} as Response;
}

function mockNext(): NextFunction {
  return vi.fn();
}

describe("createSessionAuth middleware", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes through when no session token is provided", async () => {
    const prisma = {
      userSession: {
        findFirst: vi.fn(),
        updateMany: vi.fn(),
      },
    } as any;
    const middleware = createSessionAuth(prisma);
    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(prisma.userSession.findFirst).not.toHaveBeenCalled();
  });

  it("hydrates auth context for a valid token from x-session-token", async () => {
    const rawToken = "session-token-abc";
    const hashed = hashSessionToken(rawToken);
    const prisma = {
      userSession: {
        findFirst: vi.fn(async ({ where }: any) => {
          if (where.sessionToken !== hashed) return null;
          return {
            id: "sess-1",
            expiresAt: new Date(Date.now() + 60_000),
            user: {
              id: "user-1",
              organizationId: "org-1",
              role: "ADMIN",
            },
          };
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    } as any;
    const middleware = createSessionAuth(prisma);
    const req = mockReq({
      headers: { "x-session-token": rawToken },
    }) as any;
    const res = mockRes();
    const next = mockNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.sessionId).toBe("sess-1");
    expect(req.userId).toBe("user-1");
    expect(req.organizationId).toBe("org-1");
    expect(req.userRole).toBe("ADMIN");
    expect(prisma.userSession.updateMany).toHaveBeenCalled();
  });

  it("revokes and ignores expired sessions", async () => {
    const rawToken = "expired-token";
    const prisma = {
      userSession: {
        findFirst: vi.fn().mockResolvedValue({
          id: "sess-expired",
          expiresAt: new Date(Date.now() - 1_000),
          user: {
            id: "user-1",
            organizationId: "org-1",
            role: "MEMBER",
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    } as any;
    const middleware = createSessionAuth(prisma);
    const req = mockReq({
      headers: { authorization: `Bearer ${rawToken}` },
    }) as any;
    const res = mockRes();
    const next = mockNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.userId).toBeUndefined();
    expect(req.organizationId).toBeUndefined();
    expect(prisma.userSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sess-expired", revokedAt: null },
      })
    );
  });
});
