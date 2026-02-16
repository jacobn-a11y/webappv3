/**
 * Tests for API Key Authentication Middleware
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Response, NextFunction } from "express";
import {
  hashApiKey,
  generateApiKey,
  createApiKeyAuth,
  requireScope,
  type ApiKeyAuthRequest,
} from "../middleware/api-key-auth.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mockRequest(overrides: Partial<ApiKeyAuthRequest> = {}): ApiKeyAuthRequest {
  return {
    headers: {},
    ...overrides,
  } as ApiKeyAuthRequest;
}

function mockResponse(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

function mockNext(): NextFunction {
  return vi.fn();
}

// ─── hashApiKey ──────────────────────────────────────────────────────────────

describe("hashApiKey", () => {
  it("returns a consistent SHA-256 hex hash", () => {
    const hash = hashApiKey("se_live_testkey123");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hashApiKey("se_live_testkey123")).toBe(hash); // deterministic
  });

  it("returns different hashes for different keys", () => {
    expect(hashApiKey("key_a")).not.toBe(hashApiKey("key_b"));
  });
});

// ─── generateApiKey ──────────────────────────────────────────────────────────

describe("generateApiKey", () => {
  it("returns raw, hash, and prefix", () => {
    const result = generateApiKey();
    expect(result.raw).toMatch(/^se_live_/);
    expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.prefix).toBe(result.raw.slice(0, 12));
  });

  it("hash matches the raw key when hashed", () => {
    const result = generateApiKey();
    expect(hashApiKey(result.raw)).toBe(result.hash);
  });

  it("generates unique keys each time", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.raw).not.toBe(b.raw);
    expect(a.hash).not.toBe(b.hash);
  });
});

// ─── createApiKeyAuth ────────────────────────────────────────────────────────

describe("createApiKeyAuth", () => {
  let prisma: any;

  beforeEach(() => {
    prisma = {
      apiKey: {
        findUnique: vi.fn(),
        update: vi.fn().mockResolvedValue({}),
      },
    };
  });

  it("rejects requests without an API key", async () => {
    const middleware = createApiKeyAuth(prisma);
    const req = mockRequest();
    const res = mockResponse();
    const next = mockNext();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "api_key_required" })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("extracts API key from Authorization: Bearer header", async () => {
    const { raw, hash } = generateApiKey();
    prisma.apiKey.findUnique.mockResolvedValue({
      id: "key_1",
      organizationId: "org_1",
      scopes: ["rag:query"],
      revokedAt: null,
      expiresAt: null,
      organization: { id: "org_1", name: "Test", plan: "STARTER" },
    });

    const middleware = createApiKeyAuth(prisma);
    const req = mockRequest({
      headers: { authorization: `Bearer ${raw}` },
    } as any);
    const res = mockResponse();
    const next = mockNext();

    await middleware(req, res, next);

    expect(prisma.apiKey.findUnique).toHaveBeenCalledWith({
      where: { keyHash: hash },
      include: { organization: { select: { id: true, name: true, plan: true } } },
    });
    expect(next).toHaveBeenCalled();
    expect(req.apiKeyId).toBe("key_1");
    expect(req.organizationId).toBe("org_1");
    expect(req.apiKeyScopes).toEqual(["rag:query"]);
  });

  it("extracts API key from X-API-Key header", async () => {
    const { raw } = generateApiKey();
    prisma.apiKey.findUnique.mockResolvedValue({
      id: "key_2",
      organizationId: "org_2",
      scopes: ["rag:query"],
      revokedAt: null,
      expiresAt: null,
      organization: { id: "org_2", name: "Test2", plan: "STARTER" },
    });

    const middleware = createApiKeyAuth(prisma);
    const req = mockRequest({
      headers: { "x-api-key": raw },
    } as any);
    const res = mockResponse();
    const next = mockNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.apiKeyId).toBe("key_2");
  });

  it("rejects invalid API key", async () => {
    prisma.apiKey.findUnique.mockResolvedValue(null);

    const middleware = createApiKeyAuth(prisma);
    const req = mockRequest({
      headers: { authorization: "Bearer se_live_invalid" },
    } as any);
    const res = mockResponse();
    const next = mockNext();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "invalid_api_key" })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects revoked key without grace period", async () => {
    prisma.apiKey.findUnique.mockResolvedValue({
      id: "key_3",
      organizationId: "org_1",
      scopes: ["rag:query"],
      revokedAt: new Date("2024-01-01"),
      gracePeriodEndsAt: null,
      expiresAt: null,
      organization: { id: "org_1", name: "Test", plan: "STARTER" },
    });

    const middleware = createApiKeyAuth(prisma);
    const req = mockRequest({
      headers: { authorization: "Bearer se_live_revoked" },
    } as any);
    const res = mockResponse();
    const next = mockNext();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "api_key_revoked" })
    );
  });

  it("allows revoked key within grace period", async () => {
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    prisma.apiKey.findUnique.mockResolvedValue({
      id: "key_4",
      organizationId: "org_1",
      scopes: ["rag:query"],
      revokedAt: new Date(),
      gracePeriodEndsAt: futureDate,
      expiresAt: null,
      organization: { id: "org_1", name: "Test", plan: "STARTER" },
    });

    const middleware = createApiKeyAuth(prisma);
    const req = mockRequest({
      headers: { authorization: "Bearer se_live_rotating" },
    } as any);
    const res = mockResponse();
    const next = mockNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.apiKeyId).toBe("key_4");
  });

  it("rejects revoked key after grace period expires", async () => {
    const pastDate = new Date(Date.now() - 1000);
    prisma.apiKey.findUnique.mockResolvedValue({
      id: "key_5",
      organizationId: "org_1",
      scopes: ["rag:query"],
      revokedAt: new Date("2024-01-01"),
      gracePeriodEndsAt: pastDate,
      expiresAt: null,
      organization: { id: "org_1", name: "Test", plan: "STARTER" },
    });

    const middleware = createApiKeyAuth(prisma);
    const req = mockRequest({
      headers: { authorization: "Bearer se_live_expired_grace" },
    } as any);
    const res = mockResponse();
    const next = mockNext();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "api_key_revoked" })
    );
  });

  it("rejects expired key", async () => {
    const pastDate = new Date(Date.now() - 1000);
    prisma.apiKey.findUnique.mockResolvedValue({
      id: "key_6",
      organizationId: "org_1",
      scopes: ["rag:query"],
      revokedAt: null,
      expiresAt: pastDate,
      organization: { id: "org_1", name: "Test", plan: "STARTER" },
    });

    const middleware = createApiKeyAuth(prisma);
    const req = mockRequest({
      headers: { authorization: "Bearer se_live_expired" },
    } as any);
    const res = mockResponse();
    const next = mockNext();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "api_key_expired" })
    );
  });

  it("allows key that has not yet expired", async () => {
    const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    prisma.apiKey.findUnique.mockResolvedValue({
      id: "key_7",
      organizationId: "org_1",
      scopes: ["rag:query"],
      revokedAt: null,
      expiresAt: futureDate,
      organization: { id: "org_1", name: "Test", plan: "STARTER" },
    });

    const middleware = createApiKeyAuth(prisma);
    const req = mockRequest({
      headers: { authorization: "Bearer se_live_valid" },
    } as any);
    const res = mockResponse();
    const next = mockNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});

// ─── requireScope ────────────────────────────────────────────────────────────

describe("requireScope", () => {
  it("allows request with matching scope", () => {
    const middleware = requireScope("rag:query");
    const req = mockRequest({ apiKeyScopes: ["rag:query"] } as any);
    const res = mockResponse();
    const next = mockNext();

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it("rejects request missing required scope", () => {
    const middleware = requireScope("rag:query");
    const req = mockRequest({ apiKeyScopes: ["other:scope"] } as any);
    const res = mockResponse();
    const next = mockNext();

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "insufficient_scope" })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects request with no scopes", () => {
    const middleware = requireScope("rag:query");
    const req = mockRequest({} as any);
    const res = mockResponse();
    const next = mockNext();

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
  });
});
