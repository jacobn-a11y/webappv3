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
      findFirst: vi.fn(),
      count: vi.fn(),
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
    delete process.env.INTEGRATION_DEAD_LETTER_REPLAY_WINDOW_HOURS;
    delete process.env.INTEGRATION_DEAD_LETTER_REPLAY_ATTEMPT_CAP;
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

  it("skips duplicate running idempotency run after worker restart", async () => {
    prisma.integrationRun.findUnique.mockResolvedValue({
      id: "run-running",
      status: "RUNNING",
      organizationId: "org-1",
      idempotencyKey: "manual:cfg-1:running",
    });

    const fetchCalls = vi.fn();
    const engine = new SyncEngine(prisma, processingQueue, {
      callRecording: new Map([["GONG", { fetchCalls }]]),
      crm: new Map(),
    } as any);

    const runId = await engine.syncIntegration(makeConfig(), {
      runType: "MANUAL",
      idempotencyKey: "manual:cfg-1:running",
    });

    expect(runId).toBe("run-running");
    expect(fetchCalls).not.toHaveBeenCalled();
    expect(prisma.integrationRun.create).not.toHaveBeenCalled();
    expect(prisma.integrationRun.update).not.toHaveBeenCalled();
  });

  it("restarts failed idempotent run and completes without creating a duplicate run row", async () => {
    prisma.integrationRun.findUnique.mockResolvedValue({
      id: "run-failed-restart",
      status: "FAILED",
      organizationId: "org-1",
      idempotencyKey: "manual:cfg-1:restart",
    });
    prisma.integrationRun.update
      .mockResolvedValueOnce({
        id: "run-failed-restart",
        status: "RUNNING",
      })
      .mockResolvedValueOnce({
        id: "run-failed-restart",
        status: "COMPLETED",
      });

    const fetchCalls = vi.fn().mockResolvedValue({
      data: [],
      nextCursor: null,
      hasMore: false,
    });
    const engine = new SyncEngine(prisma, processingQueue, {
      callRecording: new Map([["GONG", { fetchCalls, name: "Gong", callProvider: "GONG" }]]),
      crm: new Map(),
    } as any);

    const runId = await engine.syncIntegration(makeConfig(), {
      runType: "MANUAL",
      idempotencyKey: "manual:cfg-1:restart",
    });

    expect(runId).toBe("run-failed-restart");
    expect(prisma.integrationRun.create).not.toHaveBeenCalled();
    expect(prisma.integrationRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "run-failed-restart" },
        data: expect.objectContaining({
          status: "RUNNING",
          finishedAt: null,
          processedCount: 0,
          successCount: 0,
          failureCount: 0,
        }),
      })
    );
    expect(prisma.integrationRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "run-failed-restart" },
        data: expect.objectContaining({
          status: "COMPLETED",
        }),
      })
    );
    expect(fetchCalls).toHaveBeenCalledTimes(1);
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

  it("blocks dead-letter replay when the source run is outside the replay window", async () => {
    process.env.INTEGRATION_DEAD_LETTER_REPLAY_WINDOW_HOURS = "1";
    prisma.integrationRun.findFirst.mockResolvedValue({
      id: "run-old",
      organizationId: "org-1",
      status: "FAILED",
      startedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      finishedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      integrationConfig: makeConfig(),
    });

    const engine = new SyncEngine(prisma, processingQueue, {
      callRecording: new Map(),
      crm: new Map(),
    } as any);
    const replaySpy = vi.spyOn(engine, "syncIntegration");

    await expect(engine.replayFailedRun("run-old", "org-1")).rejects.toThrow(
      "Replay window exceeded"
    );
    expect(replaySpy).not.toHaveBeenCalled();
  });

  it("blocks dead-letter replay when replay attempt cap is reached", async () => {
    process.env.INTEGRATION_DEAD_LETTER_REPLAY_ATTEMPT_CAP = "2";
    prisma.integrationRun.findFirst.mockResolvedValue({
      id: "run-failed",
      organizationId: "org-1",
      status: "FAILED",
      startedAt: new Date(),
      finishedAt: new Date(),
      integrationConfig: makeConfig(),
    });
    prisma.integrationRun.count.mockResolvedValue(2);

    const engine = new SyncEngine(prisma, processingQueue, {
      callRecording: new Map(),
      crm: new Map(),
    } as any);
    const replaySpy = vi.spyOn(engine, "syncIntegration");

    await expect(
      engine.replayFailedRun("run-failed", "org-1")
    ).rejects.toThrow("Replay attempt cap reached");
    expect(replaySpy).not.toHaveBeenCalled();
  });

  it("returns replay metadata when a dead-letter replay is accepted", async () => {
    prisma.integrationRun.findFirst.mockResolvedValue({
      id: "run-failed",
      organizationId: "org-1",
      status: "FAILED",
      startedAt: new Date(Date.now() - 20 * 60 * 1000),
      finishedAt: new Date(Date.now() - 15 * 60 * 1000),
      integrationConfig: makeConfig(),
    });
    prisma.integrationRun.count.mockResolvedValue(1);

    const engine = new SyncEngine(prisma, processingQueue, {
      callRecording: new Map(),
      crm: new Map(),
    } as any);
    const replaySpy = vi
      .spyOn(engine, "syncIntegration")
      .mockResolvedValue("run-replay-2");

    const result = await engine.replayFailedRun("run-failed", "org-1");

    expect(result.replayRunId).toBe("run-replay-2");
    expect(result.replayAttempt).toBe(2);
    expect(result.replayAttemptCap).toBe(3);
    expect(result.replayWindowHours).toBe(72);
    expect(replaySpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: "cfg-1" }),
      expect.objectContaining({
        runType: "REPLAY",
        metadata: expect.objectContaining({
          replay_of_run_id: "run-failed",
          replay_attempt: 2,
          replay_attempt_cap: 3,
          replay_window_hours: 72,
        }),
      })
    );
  });
});
