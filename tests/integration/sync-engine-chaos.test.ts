import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IntegrationConfig } from "@prisma/client";
import { SyncEngine } from "../../src/integrations/sync-engine.js";

function makeConfig(overrides?: Partial<IntegrationConfig>): IntegrationConfig {
  return {
    id: "cfg-1",
    organizationId: "org-1",
    provider: "GONG",
    enabled: true,
    credentials: {},
    settings: null,
    lastSyncAt: null,
    syncCursor: null,
    webhookSecret: null,
    status: "ACTIVE",
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as IntegrationConfig;
}

describe("SyncEngine chaos/reliability", () => {
  const prisma = {
    integrationRun: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    integrationConfig: {
      update: vi.fn(),
    },
  } as any;

  const processingQueue = {
    add: vi.fn(),
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retries transient errors and eventually succeeds", async () => {
    const engine = new SyncEngine(prisma, processingQueue, {
      callRecording: new Map(),
      crm: new Map(),
    } as any);

    let attempts = 0;
    const result = await (engine as any).withRetry(async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new Error("transient failure");
      }
      return "ok";
    }, { attempts: 4, baseDelayMs: 1 });

    expect(result).toBe("ok");
    expect(attempts).toBe(3);
  });

  it("skips duplicate completed idempotency run", async () => {
    prisma.integrationRun.findUnique.mockResolvedValue({
      id: "run-existing",
      status: "COMPLETED",
      organizationId: "org-1",
      idempotencyKey: "manual:cfg-1:abc",
    });

    const fetchCalls = vi.fn();
    const engine = new SyncEngine(prisma, processingQueue, {
      callRecording: new Map([["GONG", { fetchCalls }]]),
      crm: new Map(),
    } as any);

    const runId = await engine.syncIntegration(makeConfig(), {
      runType: "MANUAL",
      idempotencyKey: "manual:cfg-1:abc",
    });

    expect(runId).toBe("run-existing");
    expect(fetchCalls).not.toHaveBeenCalled();
    expect(prisma.integrationRun.create).not.toHaveBeenCalled();
  });

  it("marks run as FAILED when provider continuously errors", async () => {
    prisma.integrationRun.findUnique.mockResolvedValue(null);
    prisma.integrationRun.create.mockResolvedValue({
      id: "run-1",
      status: "RUNNING",
    });
    prisma.integrationRun.update.mockResolvedValue({
      id: "run-1",
      status: "FAILED",
    });

    const fetchCalls = vi.fn().mockRejectedValue(new Error("provider outage"));
    const engine = new SyncEngine(prisma, processingQueue, {
      callRecording: new Map([["GONG", { fetchCalls }]]),
      crm: new Map(),
    } as any);
    // Remove real sleep/jitter for deterministic, fast chaos testing.
    (engine as any).withRetry = async (fn: () => Promise<unknown>) => {
      let lastError: unknown;
      for (let i = 0; i < 4; i += 1) {
        try {
          return await fn();
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError;
    };

    await expect(
      engine.syncIntegration(makeConfig(), {
        runType: "MANUAL",
        idempotencyKey: "manual:cfg-1:def",
      })
    ).rejects.toThrow("provider outage");

    expect(fetchCalls).toHaveBeenCalledTimes(4);
    expect(prisma.integrationRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "run-1" },
        data: expect.objectContaining({
          status: "FAILED",
          failureCount: expect.any(Number),
          errorMessage: "provider outage",
        }),
      })
    );
  });
});
