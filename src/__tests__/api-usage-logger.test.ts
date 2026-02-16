/**
 * Tests for API Usage Logger Middleware
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import type { NextFunction } from "express";
import type { ApiKeyAuthRequest } from "../middleware/api-key-auth.js";
import { createApiUsageLogger } from "../middleware/api-usage-logger.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mockRequest(
  overrides: Partial<ApiKeyAuthRequest> = {}
): ApiKeyAuthRequest {
  return {
    apiKeyId: "key_1",
    organizationId: "org_1",
    originalUrl: "/api/v1/rag/query",
    method: "POST",
    headers: {},
    ...overrides,
  } as ApiKeyAuthRequest;
}

function mockResponse(): EventEmitter & {
  statusCode: number;
  json: ReturnType<typeof vi.fn>;
} {
  const res = new EventEmitter() as any;
  res.statusCode = 200;
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

function mockNext(): NextFunction {
  return vi.fn();
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("createApiUsageLogger", () => {
  let prisma: any;

  beforeEach(() => {
    prisma = {
      apiUsageLog: {
        create: vi.fn().mockResolvedValue({}),
      },
    };
  });

  it("logs usage after response finishes", async () => {
    const logger = createApiUsageLogger(prisma);
    const req = mockRequest();
    const res = mockResponse();
    const next = mockNext();

    logger(req, res as any, next);

    expect(next).toHaveBeenCalled();

    // Simulate response finishing
    res.emit("finish");

    // Allow async log write to complete
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(prisma.apiUsageLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        apiKeyId: "key_1",
        organizationId: "org_1",
        endpoint: "/api/v1/rag/query",
        method: "POST",
        statusCode: 200,
        responseTimeMs: expect.any(Number),
      }),
    });
  });

  it("captures tokens_used from response body", async () => {
    const logger = createApiUsageLogger(prisma);
    const req = mockRequest();
    const res = mockResponse();
    const next = mockNext();

    logger(req, res as any, next);

    // Simulate sending a response with tokens_used
    (res.json as (body: unknown) => unknown)({ answer: "test", tokens_used: 450 });
    res.emit("finish");

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(prisma.apiUsageLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tokensUsed: 450,
      }),
    });
  });

  it("logs null tokens when response has no tokens_used", async () => {
    const logger = createApiUsageLogger(prisma);
    const req = mockRequest();
    const res = mockResponse();
    const next = mockNext();

    logger(req, res as any, next);

    (res.json as (body: unknown) => unknown)({ answer: "test" });
    res.emit("finish");

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(prisma.apiUsageLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tokensUsed: null,
      }),
    });
  });

  it("skips logging if no API key is on the request", () => {
    const logger = createApiUsageLogger(prisma);
    const req = mockRequest({ apiKeyId: undefined });
    const res = mockResponse();
    const next = mockNext();

    logger(req, res as any, next);

    expect(next).toHaveBeenCalled();

    res.emit("finish");

    expect(prisma.apiUsageLog.create).not.toHaveBeenCalled();
  });

  it("does not block the response if DB write fails", async () => {
    prisma.apiUsageLog.create.mockRejectedValue(new Error("DB down"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const logger = createApiUsageLogger(prisma);
    const req = mockRequest();
    const res = mockResponse();
    const next = mockNext();

    logger(req, res as any, next);
    res.emit("finish");

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(consoleSpy).toHaveBeenCalledWith(
      "Failed to log API usage:",
      expect.any(Error)
    );
    consoleSpy.mockRestore();
  });
});
