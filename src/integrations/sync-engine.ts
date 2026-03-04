/**
 * Integration Sync Engine
 *
 * Orchestrates periodic data sync from all enabled direct integrations.
 * Uses BullMQ repeatable jobs to poll providers on a configurable schedule.
 *
 * The sync engine:
 *   1. Discovers all enabled IntegrationConfigs across all orgs
 *   2. For each config, calls the appropriate provider to fetch new data
 *   3. Normalizes and persists the data through existing Prisma models
 *   4. Queues calls for the existing processing pipeline (chunk → tag → embed)
 *   5. Updates the sync cursor and status for incremental sync
 *
 * Call recording providers (Grain, Gong) feed into the Call → Transcript
 * pipeline. CRM providers (Salesforce) feed into Account → Contact →
 * Opportunity models for entity resolution.
 */

import { Prisma, type PrismaClient, type IntegrationConfig } from "@prisma/client";
import type { Queue } from "bullmq";
import type { ProcessCallJob } from "../services/transcript-processor.js";
import { enqueueProcessCallJob } from "../lib/queue-policy.js";
import {
  EntityResolver,
  normalizeCompanyName,
  extractEmailDomain,
} from "../services/entity-resolution.js";
import { decodeCredentials } from "../types/json-boundaries.js";
import { resolveIntegrationProviderSelection } from "../services/provider-policy.js";
import logger from "../lib/logger.js";
import type {
  CallRecordingProvider,
  CRMDataProvider,
  NormalizedCall,
  NormalizedAccount,
  NormalizedContact,
  NormalizedOpportunity,
  ProviderCredentials,
  ProviderRegistry,
} from "./types.js";
import { coerceProviderCredentials } from "./types.js";
import type { SalesforceProvider } from "./salesforce-provider.js";

// ─── Sync Engine ────────────────────────────────────────────────────────────

const DEFAULT_DEAD_LETTER_REPLAY_WINDOW_HOURS = 72;
const MAX_DEAD_LETTER_REPLAY_WINDOW_HOURS = 24 * 30;
const DEFAULT_DEAD_LETTER_REPLAY_ATTEMPT_CAP = 3;
const MAX_DEAD_LETTER_REPLAY_ATTEMPT_CAP = 20;

interface ReplayPolicy {
  replayWindowHours: number;
  replayWindowMs: number;
  replayAttemptCap: number;
}

export interface ReplayFailedRunResult {
  sourceRunId: string;
  replayRunId: string;
  replayAttempt: number;
  replayAttemptCap: number;
  replayWindowHours: number;
  sourceRunAgeHours: number;
}

export class SyncEngine {
  private prisma: PrismaClient;
  private processingQueue: Queue;
  private registry: ProviderRegistry;

  constructor(
    prisma: PrismaClient,
    processingQueue: Queue,
    registry: ProviderRegistry
  ) {
    this.prisma = prisma;
    this.processingQueue = processingQueue;
    this.registry = registry;
  }

  private async withRetry<T>(
    fn: () => Promise<T>,
    opts?: { attempts?: number; baseDelayMs?: number }
  ): Promise<T> {
    const attempts = opts?.attempts ?? 3;
    const baseDelayMs = opts?.baseDelayMs ?? 750;
    let lastError: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        if (i === attempts - 1) break;
        const exp = baseDelayMs * 2 ** i;
        const jitter = Math.floor(Math.random() * Math.max(100, exp * 0.25));
        const waitMs = exp + jitter;
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Retry attempts exhausted");
  }

  private async queueMergeConflictReview(input: {
    organizationId: string;
    targetType: string;
    targetId: string;
    requestPayload: Record<string, unknown>;
  }): Promise<void> {
    const existing = await this.prisma.approvalRequest.findFirst({
      where: {
        organizationId: input.organizationId,
        requestType: "DATA_MERGE_CONFLICT",
        targetType: input.targetType,
        targetId: input.targetId,
        status: "PENDING",
      },
      select: { id: true },
    });
    if (existing) return;

    const owner = await this.prisma.user.findFirst({
      where: {
        organizationId: input.organizationId,
        role: { in: ["OWNER", "ADMIN"] },
      },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    if (!owner) return;

    await this.prisma.approvalRequest.create({
      data: {
        organizationId: input.organizationId,
        requestType: "DATA_MERGE_CONFLICT",
        targetType: input.targetType,
        targetId: input.targetId,
        requestedByUserId: owner.id,
        status: "PENDING",
        requestPayload: input.requestPayload as Prisma.InputJsonValue,
      },
    });
  }

  private async startIntegrationRun(input: {
    config: IntegrationConfig;
    runType: string;
    idempotencyKey: string;
    metadata?: Record<string, unknown> | null;
  }) {
    const existing = await this.prisma.integrationRun.findUnique({
      where: {
        organizationId_idempotencyKey: {
          organizationId: input.config.organizationId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existing) {
      if (existing.status === "COMPLETED" || existing.status === "RUNNING") {
        return { run: existing, skipped: true };
      }
      const restarted = await this.prisma.integrationRun.update({
        where: { id: existing.id },
        data: {
          status: "RUNNING",
          startedAt: new Date(),
          finishedAt: null,
          errorMessage: null,
          processedCount: 0,
          successCount: 0,
          failureCount: 0,
          metadata: {
            trigger: input.runType,
            ...(input.metadata ?? {}),
          } as Prisma.InputJsonValue,
        },
      });
      return { run: restarted, skipped: false };
    }

    const run = await this.prisma.integrationRun.create({
      data: {
        organizationId: input.config.organizationId,
        integrationConfigId: input.config.id,
        provider: input.config.provider,
        runType: input.runType,
        status: "RUNNING",
        idempotencyKey: input.idempotencyKey,
        metadata: {
          trigger: input.runType,
          ...(input.metadata ?? {}),
        } as Prisma.InputJsonValue,
      },
    });
    return { run, skipped: false };
  }

  private async finishIntegrationRun(input: {
    runId: string;
    status: "COMPLETED" | "FAILED";
    processedCount: number;
    successCount: number;
    failureCount: number;
    errorMessage?: string | null;
  }) {
    await this.prisma.integrationRun.update({
      where: { id: input.runId },
      data: {
        status: input.status,
        finishedAt: new Date(),
        processedCount: input.processedCount,
        successCount: input.successCount,
        failureCount: input.failureCount,
        errorMessage: input.errorMessage ?? null,
      },
    });
  }

  /**
   * Run a full sync cycle for all enabled integrations across all orgs.
   * Called by the BullMQ repeatable job scheduler.
   */
  async syncAll(): Promise<void> {
    const configs = await this.prisma.integrationConfig.findMany({
      where: {
        enabled: true,
        status: { in: ["ACTIVE", "ERROR"] }, // retry errored ones too
      },
    });

    for (const config of configs) {
      try {
        const hourBucket = new Date().toISOString().slice(0, 13);
        await this.syncIntegration(config, {
          runType: "SCHEDULED",
          idempotencyKey: `scheduled:${config.id}:${hourBucket}`,
        });
      } catch (err) {
        logger.error(
          `Sync failed for ${config.provider} (org: ${config.organizationId})`,
          { error: err }
        );
        await this.prisma.integrationConfig.update({
          where: { id: config.id },
          data: {
            status: "ERROR",
            lastError:
              err instanceof Error ? err.message : "Unknown sync error",
          },
        });
      }
    }
  }

  /**
   * Sync a single integration config. Used for on-demand sync triggers.
   */
  async syncIntegration(
    config: IntegrationConfig,
    options?: {
      runType?: "SCHEDULED" | "MANUAL" | "BACKFILL" | "REPLAY";
      idempotencyKey?: string;
      sinceOverride?: Date | null;
      cursorOverride?: string | null;
      metadata?: Record<string, unknown> | null;
    }
  ): Promise<string> {
    const runType = options?.runType ?? "MANUAL";
    const idempotencyKey =
      options?.idempotencyKey ??
      `${runType.toLowerCase()}:${config.id}:${Date.now()}`;
    const started = await this.startIntegrationRun({
      config,
      runType,
      idempotencyKey,
      metadata: options?.metadata ?? null,
    });
    if (started.skipped) return started.run.id;

    let processedCount = 0;
    let successCount = 0;
    let failureCount = 0;
    const credentials = coerceProviderCredentials(
      decodeCredentials(config.credentials)
    );

    try {
      // Route to the appropriate sync handler
      const selection = resolveIntegrationProviderSelection(
        config.provider,
        this.registry
      );
      if (selection.kind === "call_recording" && selection.callProvider) {
        const synced = await this.syncCallRecordingProvider(
          config,
          selection.callProvider,
          credentials,
          {
            sinceOverride: options?.sinceOverride ?? null,
            cursorOverride: options?.cursorOverride ?? null,
          }
        );
        processedCount += synced;
        successCount += synced;
      } else if (selection.kind === "crm" && selection.crmProvider) {
        const synced = await this.syncCRMProvider(
          config,
          selection.crmProvider,
          credentials
        );
        processedCount += synced;
        successCount += synced;
      } else {
        throw new Error(
          `No provider implementation registered for ${config.provider}`
        );
      }

      await this.finishIntegrationRun({
        runId: started.run.id,
        status: "COMPLETED",
        processedCount,
        successCount,
        failureCount,
      });
      return started.run.id;
    } catch (err) {
      failureCount = Math.max(1, processedCount - successCount);
      await this.finishIntegrationRun({
        runId: started.run.id,
        status: "FAILED",
        processedCount,
        successCount,
        failureCount,
        errorMessage: err instanceof Error ? err.message : "Unknown sync error",
      });
      throw err;
    }
  }

  private resolveReplayPolicy(): ReplayPolicy {
    const rawWindow = Number(
      process.env.INTEGRATION_DEAD_LETTER_REPLAY_WINDOW_HOURS
    );
    const replayWindowHours = Number.isFinite(rawWindow)
      ? Math.max(
          1,
          Math.min(
            MAX_DEAD_LETTER_REPLAY_WINDOW_HOURS,
            Math.floor(rawWindow)
          )
        )
      : DEFAULT_DEAD_LETTER_REPLAY_WINDOW_HOURS;

    const rawAttemptCap = Number(
      process.env.INTEGRATION_DEAD_LETTER_REPLAY_ATTEMPT_CAP
    );
    const replayAttemptCap = Number.isFinite(rawAttemptCap)
      ? Math.max(
          1,
          Math.min(
            MAX_DEAD_LETTER_REPLAY_ATTEMPT_CAP,
            Math.floor(rawAttemptCap)
          )
        )
      : DEFAULT_DEAD_LETTER_REPLAY_ATTEMPT_CAP;

    return {
      replayWindowHours,
      replayWindowMs: replayWindowHours * 60 * 60 * 1000,
      replayAttemptCap,
    };
  }

  async replayFailedRun(
    runId: string,
    organizationId: string
  ): Promise<ReplayFailedRunResult> {
    const run = await this.prisma.integrationRun.findFirst({
      where: {
        id: runId,
        organizationId,
      },
      include: { integrationConfig: true },
    });
    if (!run || !run.integrationConfig) {
      throw new Error("Integration run not found for this organization.");
    }
    if (run.status !== "FAILED") {
      throw new Error("Only failed integration runs can be replayed.");
    }

    const replayPolicy = this.resolveReplayPolicy();
    const replayReference = run.finishedAt ?? run.startedAt;
    const sourceRunAgeMs = Date.now() - replayReference.getTime();
    if (sourceRunAgeMs > replayPolicy.replayWindowMs) {
      throw new Error(
        `Replay window exceeded. Runs older than ${replayPolicy.replayWindowHours} hours cannot be replayed.`
      );
    }

    const replayPrefix = `replay:${run.id}:`;
    const previousReplayAttempts = await this.prisma.integrationRun.count({
      where: {
        organizationId,
        runType: "REPLAY",
        idempotencyKey: { startsWith: replayPrefix },
      },
    });
    if (previousReplayAttempts >= replayPolicy.replayAttemptCap) {
      throw new Error(
        `Replay attempt cap reached (${replayPolicy.replayAttemptCap}). Create a new backfill run instead.`
      );
    }
    const replayAttempt = previousReplayAttempts + 1;

    const replayRunId = await this.syncIntegration(run.integrationConfig, {
      runType: "REPLAY",
      idempotencyKey: `replay:${run.id}:${Date.now()}`,
      metadata: {
        replay_of_run_id: run.id,
        replay_attempt: replayAttempt,
        replay_attempt_cap: replayPolicy.replayAttemptCap,
        replay_window_hours: replayPolicy.replayWindowHours,
        source_run_started_at: run.startedAt.toISOString(),
        source_run_finished_at: run.finishedAt?.toISOString() ?? null,
      },
    });

    return {
      sourceRunId: run.id,
      replayRunId,
      replayAttempt,
      replayAttemptCap: replayPolicy.replayAttemptCap,
      replayWindowHours: replayPolicy.replayWindowHours,
      sourceRunAgeHours: Math.round((sourceRunAgeMs / (60 * 60 * 1000)) * 100) / 100,
    };
  }

  // ─── Call Recording Sync ──────────────────────────────────────────────────

  private async syncCallRecordingProvider(
    config: IntegrationConfig,
    provider: CallRecordingProvider,
    credentials: ProviderCredentials,
    options?: { sinceOverride?: Date | null; cursorOverride?: string | null }
  ): Promise<number> {
    let cursor = options?.cursorOverride ?? config.syncCursor;
    let hasMore = true;
    let totalSynced = 0;
    const resolver = new EntityResolver(this.prisma);

    while (hasMore) {
      const result = await this.withRetry(
        () =>
          provider.fetchCalls(
            credentials,
            cursor,
            options?.sinceOverride ?? config.lastSyncAt,
            {
              settings:
                config.settings &&
                typeof config.settings === "object" &&
                !Array.isArray(config.settings)
                  ? (config.settings as Record<string, unknown>)
                  : null,
            }
          ),
        { attempts: 4, baseDelayMs: 1000 }
      );

      for (const normalizedCall of result.data) {
        await this.persistCall(
          config,
          provider,
          resolver,
          normalizedCall
        );
        totalSynced++;
      }

      cursor = result.nextCursor;
      hasMore = result.hasMore && !!cursor;

      // Update cursor after each page to allow resume on failure
      await this.prisma.integrationConfig.update({
        where: { id: config.id },
        data: { syncCursor: cursor },
      });
    }

    // Mark sync complete
    await this.prisma.integrationConfig.update({
      where: { id: config.id },
      data: {
        lastSyncAt: new Date(),
        syncCursor: null, // reset cursor for next full sync
        status: "ACTIVE",
        lastError: null,
      },
    });

    if (totalSynced > 0) {
      logger.info(
        `Synced ${totalSynced} calls from ${provider.name} for org ${config.organizationId}`
      );
    }
    return totalSynced;
  }

  private async persistCall(
    config: IntegrationConfig,
    provider: CallRecordingProvider,
    resolver: EntityResolver,
    normalizedCall: NormalizedCall
  ): Promise<void> {
    const organizationId = config.organizationId;

    const { call, hasTranscript } = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.call.findFirst({
        where: {
          organizationId,
          provider: provider.callProvider,
          externalId: normalizedCall.externalId,
        },
      });

      const call = existing
        ? await tx.call.update({
            where: { id: existing.id },
            data: {
              title: normalizedCall.title ?? undefined,
              recordingUrl: normalizedCall.recordingUrl ?? undefined,
              duration: normalizedCall.duration ?? undefined,
            },
          })
        : await tx.call.create({
            data: {
              organizationId,
              title: normalizedCall.title,
              provider: provider.callProvider,
              externalId: normalizedCall.externalId,
              recordingUrl: normalizedCall.recordingUrl,
              duration: normalizedCall.duration,
              occurredAt: normalizedCall.occurredAt,
            },
          });

      if (!existing && normalizedCall.participants.length > 0) {
        await tx.callParticipant.createMany({
          data: normalizedCall.participants.map((p) => ({
            callId: call.id,
            email: p.email,
            name: p.name,
            isHost: p.isHost,
          })),
        });
      }

      let hasTranscript = false;
      if (normalizedCall.transcript && !existing) {
        await tx.transcript.create({
          data: {
            callId: call.id,
            fullText: normalizedCall.transcript,
            wordCount: normalizedCall.transcript.split(/\s+/).length,
          },
        });
        hasTranscript = true;
      }

      return { call, hasTranscript };
    });

    // Entity resolution (outside transaction)
    const participantInputs = normalizedCall.participants.map((p) => ({
      email: p.email ?? undefined,
      name: p.name ?? undefined,
    }));

    const resolution = await resolver.resolveAndLinkContacts(
      organizationId,
      call.id,
      participantInputs,
      normalizedCall.title ?? undefined
    );

    if (
      !resolution.accountId &&
      normalizedCall.accountHints &&
      normalizedCall.accountHints.length > 0
    ) {
      await this.linkCallByProviderAccountHints({
        organizationId,
        callId: call.id,
        participants: normalizedCall.participants,
        accountHints: normalizedCall.accountHints,
      });
    }

    // Queue for processing pipeline (chunking → tagging → embedding)
    if (hasTranscript) {
      const job: ProcessCallJob = {
        callId: call.id,
        organizationId,
        accountId:
          (await this.prisma.call.findUnique({
            where: { id: call.id },
            select: { accountId: true },
          }))?.accountId ?? null,
        hasTranscript: true,
      };

      await enqueueProcessCallJob({
        queue: this.processingQueue,
        payload: job,
        source: "integration-sync",
      });
    }
  }

  private async linkCallByProviderAccountHints(input: {
    organizationId: string;
    callId: string;
    participants: NormalizedCall["participants"];
    accountHints: string[];
  }): Promise<void> {
    const normalizedHints = input.accountHints
      .map((hint) => {
        const name = String(hint ?? "").trim();
        return {
          name,
          normalized: normalizeCompanyName(name),
        };
      })
      .filter((hint) => hint.name.length > 1 && hint.normalized.length > 1);

    if (normalizedHints.length === 0) return;

    const participantDomains = input.participants
      .map((p) => (p.email ? extractEmailDomain(p.email) : null))
      .filter((domain): domain is string => Boolean(domain));

    let account = null as { id: string; name: string } | null;

    for (const hint of normalizedHints) {
      account = await this.prisma.account.findFirst({
        where: {
          organizationId: input.organizationId,
          OR: [
            { normalizedName: hint.normalized },
            { name: { equals: hint.name, mode: "insensitive" } },
          ],
        },
        select: { id: true, name: true },
      });
      if (account) break;
    }

    if (!account && participantDomains.length > 0) {
      account = await this.prisma.account.findFirst({
        where: {
          organizationId: input.organizationId,
          domain: { in: participantDomains },
        },
        select: { id: true, name: true },
      });
    }

    if (!account) {
      const best = normalizedHints[0];
      if (!best) return;
      const domain = participantDomains[0] ?? null;
      account = await this.prisma.account.create({
        data: {
          organizationId: input.organizationId,
          name: best.name,
          normalizedName: best.normalized,
          domain,
        },
        select: { id: true, name: true },
      });
    }

    await this.prisma.call.update({
      where: { id: input.callId },
      data: {
        accountId: account.id,
        matchMethod: "FUZZY_NAME",
        matchConfidence: 0.7,
      },
    });

    const upsertOps = input.participants
      .filter((p) => p.email && extractEmailDomain(p.email))
      .map((participant) => {
        const domain = extractEmailDomain(participant.email!)!;
        return this.prisma.contact.upsert({
          where: {
            accountId_email: {
              accountId: account.id,
              email: participant.email!.toLowerCase(),
            },
          },
          create: {
            accountId: account.id,
            email: participant.email!.toLowerCase(),
            emailDomain: domain,
            name: participant.name ?? null,
            title: participant.title ?? null,
          },
          update: {
            name: participant.name ?? undefined,
            title: participant.title ?? undefined,
          },
        });
      });
    if (upsertOps.length > 0) {
      await this.prisma.$transaction(upsertOps);
    }
  }

  // ─── CRM Sync ────────────────────────────────────────────────────────────

  private async syncCRMProvider(
    config: IntegrationConfig,
    provider: CRMDataProvider,
    credentials: ProviderCredentials
  ): Promise<number> {
    // Wire up token persistence for providers that support refresh
    if ("setTokenRefreshCallback" in provider && typeof (provider as SalesforceProvider).setTokenRefreshCallback === "function") {
      (provider as SalesforceProvider).setTokenRefreshCallback(async (newAccessToken) => {
        const existing = await this.prisma.integrationConfig.findUnique({
          where: { id: config.id },
        });
        if (existing) {
          const creds = existing.credentials as Record<string, unknown>;
          creds.accessToken = newAccessToken;
          await this.prisma.integrationConfig.update({
            where: { id: config.id },
            data: { credentials: creds },
          });
        }
      });
    }

    // Accounts must sync first (contacts and opportunities reference them)
    const accountCount = await this.syncAccounts(config, provider, credentials);
    const [contactCount, opportunityCount] = await Promise.all([
      this.syncContacts(config, provider, credentials),
      this.syncOpportunities(config, provider, credentials),
    ]);

    // Mark sync complete
    await this.prisma.integrationConfig.update({
      where: { id: config.id },
      data: {
        lastSyncAt: new Date(),
        syncCursor: null,
        status: "ACTIVE",
        lastError: null,
      },
    });
    return accountCount + contactCount + opportunityCount;
  }

  private async syncAccounts(
    config: IntegrationConfig,
    provider: CRMDataProvider,
    credentials: ProviderCredentials
  ): Promise<number> {
    let cursor: string | null = null;
    let hasMore = true;
    let total = 0;

    while (hasMore) {
      const result = await this.withRetry(
        () => provider.fetchAccounts(credentials, cursor, config.lastSyncAt),
        { attempts: 4, baseDelayMs: 1000 }
      );

      const BATCH_SIZE = 50;
      for (let i = 0; i < result.data.length; i += BATCH_SIZE) {
        const batch = result.data.slice(i, i + BATCH_SIZE);
        await this.persistAccountBatch(config.organizationId, batch);
        total += batch.length;
      }

      cursor = result.nextCursor;
      hasMore = result.hasMore && !!cursor;
    }
    return total;
  }

  private async persistAccountBatch(
    organizationId: string,
    accounts: NormalizedAccount[]
  ): Promise<void> {
    const externalIds = accounts.map((a) => a.externalId);

    // Batch lookup: find all existing accounts by externalId in one query
    const existingAccounts = await this.prisma.account.findMany({
      where: { organizationId, salesforceId: { in: externalIds } },
    });
    const existingByExternalId = new Map(
      existingAccounts.map((a) => [a.salesforceId, a])
    );

    const toUpdate: { account: NormalizedAccount; existingId: string }[] = [];
    const toCreate: NormalizedAccount[] = [];
    const toConflictCheck: NormalizedAccount[] = [];

    for (const account of accounts) {
      const existing = existingByExternalId.get(account.externalId);
      if (existing) {
        toUpdate.push({ account, existingId: existing.id });
      } else {
        toConflictCheck.push(account);
      }
    }

    // For new accounts, check for conflicts individually (requires per-record logic)
    for (const account of toConflictCheck) {
      const normalized = normalizeCompanyName(account.name);
      const potentialConflict = await this.prisma.account.findFirst({
        where: {
          organizationId,
          OR: [
            { normalizedName: normalized },
            ...(account.domain ? [{ domain: account.domain }] : []),
          ],
          salesforceId: { not: account.externalId },
        },
      });

      if (potentialConflict) {
        await this.queueMergeConflictReview({
          organizationId,
          targetType: "account",
          targetId: potentialConflict.id,
          requestPayload: {
            conflict_type: "ACCOUNT_EXTERNAL_ID_COLLISION",
            existing_account_id: potentialConflict.id,
            existing_salesforce_id: potentialConflict.salesforceId,
            incoming_external_id: account.externalId,
            incoming_name: account.name,
            incoming_domain: account.domain,
          },
        });
      } else {
        toCreate.push(account);
      }
    }

    await this.prisma.$transaction(async (tx) => {
      // Batch update existing accounts
      await Promise.all(
        toUpdate.map(({ account, existingId }) => {
          const normalized = normalizeCompanyName(account.name);
          return tx.account.update({
            where: { id: existingId },
            data: {
              name: account.name,
              normalizedName: normalized,
              domain: account.domain ?? undefined,
              industry: account.industry ?? undefined,
              employeeCount: account.employeeCount ?? undefined,
              annualRevenue: account.annualRevenue ?? undefined,
            },
          });
        })
      );

      // Batch create new accounts using createMany with skipDuplicates
      if (toCreate.length > 0) {
        await tx.account.createMany({
          data: toCreate.map((account) => ({
            organizationId,
            name: account.name,
            normalizedName: normalizeCompanyName(account.name),
            domain: account.domain,
            salesforceId: account.externalId,
            industry: account.industry,
            employeeCount: account.employeeCount,
            annualRevenue: account.annualRevenue,
          })),
          skipDuplicates: true,
        });
      }
    });
  }

  private async persistAccount(
    organizationId: string,
    account: NormalizedAccount
  ): Promise<void> {
    const normalized = normalizeCompanyName(account.name);
    const existingByExternal = await this.prisma.account.findFirst({
      where: { organizationId, salesforceId: account.externalId },
    });

    if (!existingByExternal) {
      const potentialConflict = await this.prisma.account.findFirst({
        where: {
          organizationId,
          OR: [
            { normalizedName: normalized },
            ...(account.domain ? [{ domain: account.domain }] : []),
          ],
          salesforceId: { not: account.externalId },
        },
      });

      if (potentialConflict) {
        await this.queueMergeConflictReview({
          organizationId,
          targetType: "account",
          targetId: potentialConflict.id,
          requestPayload: {
            conflict_type: "ACCOUNT_EXTERNAL_ID_COLLISION",
            existing_account_id: potentialConflict.id,
            existing_salesforce_id: potentialConflict.salesforceId,
            incoming_external_id: account.externalId,
            incoming_name: account.name,
            incoming_domain: account.domain,
          },
        });
        return;
      }
    }

    if (existingByExternal) {
      await this.prisma.account.update({
        where: { id: existingByExternal.id },
        data: {
          name: account.name,
          normalizedName: normalized,
          domain: account.domain ?? undefined,
          industry: account.industry ?? undefined,
          employeeCount: account.employeeCount ?? undefined,
          annualRevenue: account.annualRevenue ?? undefined,
        },
      });
      return;
    }

    await this.prisma.account.create({
      data: {
        organizationId,
        name: account.name,
        normalizedName: normalized,
        domain: account.domain,
        salesforceId: account.externalId,
        industry: account.industry,
        employeeCount: account.employeeCount,
        annualRevenue: account.annualRevenue,
      },
    });
  }

  private async syncContacts(
    config: IntegrationConfig,
    provider: CRMDataProvider,
    credentials: ProviderCredentials
  ): Promise<number> {
    let cursor: string | null = null;
    let hasMore = true;
    let total = 0;

    while (hasMore) {
      const result = await this.withRetry(
        () => provider.fetchContacts(credentials, cursor, config.lastSyncAt),
        { attempts: 4, baseDelayMs: 1000 }
      );

      const BATCH_SIZE = 50;
      for (let i = 0; i < result.data.length; i += BATCH_SIZE) {
        const batch = result.data.slice(i, i + BATCH_SIZE);
        await this.persistContactBatch(config.organizationId, batch);
        total += batch.length;
      }

      cursor = result.nextCursor;
      hasMore = result.hasMore && !!cursor;
    }
    return total;
  }

  private async persistContactBatch(
    organizationId: string,
    contacts: NormalizedContact[]
  ): Promise<void> {
    // Filter to contacts with valid emails and domains
    const validContacts = contacts
      .filter((c) => c.email)
      .map((c) => ({ contact: c, domain: extractEmailDomain(c.email!) }))
      .filter((c): c is { contact: NormalizedContact; domain: string } => !!c.domain);

    if (validContacts.length === 0) return;

    // Batch resolve accounts: collect all external IDs and domains for lookup
    const accountExternalIds = validContacts
      .map((c) => c.contact.accountExternalId)
      .filter((id): id is string => !!id);
    const contactDomains = [...new Set(validContacts.map((c) => c.domain))];

    const [accountsByExternalId, accountsByDomain] = await Promise.all([
      accountExternalIds.length > 0
        ? this.prisma.account.findMany({
            where: { organizationId, salesforceId: { in: accountExternalIds } },
          })
        : Promise.resolve([]),
      this.prisma.account.findMany({
        where: { organizationId, domain: { in: contactDomains } },
      }),
    ]);

    const externalIdMap = new Map(accountsByExternalId.map((a) => [a.salesforceId, a]));
    const domainMap = new Map(accountsByDomain.map((a) => [a.domain, a]));

    // Batch collision detection: find all existing contacts by email across org
    const allEmails = validContacts.map((c) => c.contact.email!.toLowerCase());
    const existingContacts = await this.prisma.contact.findMany({
      where: {
        email: { in: allEmails },
        account: { organizationId },
      },
      select: { id: true, email: true, accountId: true, salesforceId: true },
    });
    const existingContactByEmail = new Map(
      existingContacts.map((c) => [c.email, c])
    );

    const toCreate: Array<{
      accountId: string;
      email: string;
      emailDomain: string;
      name: string | null;
      title: string | null;
      phone: string | null;
      salesforceId: string | null;
    }> = [];

    const toUpsert: Array<{
      accountId: string;
      email: string;
      emailDomain: string;
      name: string | null;
      title: string | null;
      phone: string | null;
      externalId: string | null;
    }> = [];

    for (const { contact, domain } of validContacts) {
      // Resolve account
      let account = contact.accountExternalId
        ? externalIdMap.get(contact.accountExternalId) ?? null
        : null;
      if (!account) {
        account = domainMap.get(domain) ?? null;
      }
      if (!account) continue;

      const email = contact.email!.toLowerCase();
      const existingElsewhere = existingContactByEmail.get(email);

      // Check for cross-account collision
      if (existingElsewhere && existingElsewhere.accountId !== account.id) {
        await this.queueMergeConflictReview({
          organizationId,
          targetType: "contact",
          targetId: existingElsewhere.id,
          requestPayload: {
            conflict_type: "CONTACT_EMAIL_COLLISION",
            existing_contact_id: existingElsewhere.id,
            existing_account_id: existingElsewhere.accountId,
            incoming_account_id: account.id,
            incoming_external_id: contact.externalId,
            email,
          },
        });
        continue;
      }

      // If existing contact belongs to same account, upsert to update
      if (existingElsewhere && existingElsewhere.accountId === account.id) {
        toUpsert.push({
          accountId: account.id,
          email,
          emailDomain: domain,
          name: contact.name,
          title: contact.title,
          phone: contact.phone,
          externalId: contact.externalId,
        });
      } else {
        // New contact — collect for batch createMany
        toCreate.push({
          accountId: account.id,
          email,
          emailDomain: domain,
          name: contact.name,
          title: contact.title,
          phone: contact.phone,
          salesforceId: contact.externalId,
        });
      }
    }

    await this.prisma.$transaction(async (tx) => {
      // Execute upserts in parallel
      if (toUpsert.length > 0) {
        await Promise.all(
          toUpsert.map((item) =>
            tx.contact.upsert({
              where: {
                accountId_email: { accountId: item.accountId, email: item.email },
              },
              create: {
                accountId: item.accountId,
                email: item.email,
                emailDomain: item.emailDomain,
                name: item.name,
                title: item.title,
                phone: item.phone,
                salesforceId: item.externalId,
              },
              update: {
                name: item.name ?? undefined,
                title: item.title ?? undefined,
                phone: item.phone ?? undefined,
                salesforceId: item.externalId,
              },
            })
          )
        );
      }

      // Batch create new contacts
      if (toCreate.length > 0) {
        await tx.contact.createMany({
          data: toCreate,
          skipDuplicates: true,
        });
      }
    });
  }

  private async persistContact(
    organizationId: string,
    contact: NormalizedContact
  ): Promise<void> {
    if (!contact.email) return;

    const domain = extractEmailDomain(contact.email);
    if (!domain) return;

    // Find the account this contact belongs to
    let account = null;
    if (contact.accountExternalId) {
      account = await this.prisma.account.findFirst({
        where: { organizationId, salesforceId: contact.accountExternalId },
      });
    }

    // Fall back to domain matching
    if (!account) {
      account = await this.prisma.account.findFirst({
        where: { organizationId, domain },
      });
    }

    if (!account) return; // Can't place this contact without an account

    const existingByEmailAcrossOrg = await this.prisma.contact.findFirst({
      where: {
        email: contact.email.toLowerCase(),
        account: { organizationId },
        accountId: { not: account.id },
      },
      select: { id: true, accountId: true, salesforceId: true },
    });
    if (existingByEmailAcrossOrg) {
      await this.queueMergeConflictReview({
        organizationId,
        targetType: "contact",
        targetId: existingByEmailAcrossOrg.id,
        requestPayload: {
          conflict_type: "CONTACT_EMAIL_COLLISION",
          existing_contact_id: existingByEmailAcrossOrg.id,
          existing_account_id: existingByEmailAcrossOrg.accountId,
          incoming_account_id: account.id,
          incoming_external_id: contact.externalId,
          email: contact.email.toLowerCase(),
        },
      });
      return;
    }

    await this.prisma.contact.upsert({
      where: {
        accountId_email: {
          accountId: account.id,
          email: contact.email.toLowerCase(),
        },
      },
      create: {
        accountId: account.id,
        email: contact.email.toLowerCase(),
        emailDomain: domain,
        name: contact.name,
        title: contact.title,
        phone: contact.phone,
        salesforceId: contact.externalId,
      },
      update: {
        name: contact.name ?? undefined,
        title: contact.title ?? undefined,
        phone: contact.phone ?? undefined,
        salesforceId: contact.externalId,
      },
    });
  }

  private async syncOpportunities(
    config: IntegrationConfig,
    provider: CRMDataProvider,
    credentials: ProviderCredentials
  ): Promise<number> {
    let cursor: string | null = null;
    let hasMore = true;
    let total = 0;

    while (hasMore) {
      const result = await this.withRetry(
        () => provider.fetchOpportunities(credentials, cursor, config.lastSyncAt),
        { attempts: 4, baseDelayMs: 1000 }
      );

      const PAGE_CONCURRENCY = 10;
      for (let i = 0; i < result.data.length; i += PAGE_CONCURRENCY) {
        const batch = result.data.slice(i, i + PAGE_CONCURRENCY);
        await Promise.all(
          batch.map((opp) =>
            this.persistOpportunity(config.organizationId, opp)
          )
        );
        total += batch.length;
      }

      cursor = result.nextCursor;
      hasMore = result.hasMore && !!cursor;
    }
    return total;
  }

  private async persistOpportunity(
    organizationId: string,
    opp: NormalizedOpportunity
  ): Promise<void> {
    if (!opp.accountExternalId) return;

    const account = await this.prisma.account.findFirst({
      where: { organizationId, salesforceId: opp.accountExternalId },
    });

    if (!account) return;

    const existingOppElsewhere = await this.prisma.salesforceEvent.findFirst({
      where: {
        opportunityId: opp.externalId,
        account: { organizationId, id: { not: account.id } },
      },
      select: { id: true, accountId: true },
    });
    if (existingOppElsewhere) {
      await this.queueMergeConflictReview({
        organizationId,
        targetType: "opportunity",
        targetId: existingOppElsewhere.id,
        requestPayload: {
          conflict_type: "OPPORTUNITY_ACCOUNT_COLLISION",
          opportunity_id: opp.externalId,
          existing_account_id: existingOppElsewhere.accountId,
          incoming_account_id: account.id,
        },
      });
      return;
    }

    // Map normalized status to SalesforceEventType
    let eventType:
      | "CLOSED_WON"
      | "CLOSED_LOST"
      | "OPPORTUNITY_STAGE_CHANGE"
      | "OPPORTUNITY_CREATED";

    if (opp.status === "WON") {
      eventType = "CLOSED_WON";
    } else if (opp.status === "LOST") {
      eventType = "CLOSED_LOST";
    } else {
      eventType = "OPPORTUNITY_STAGE_CHANGE";
    }

    // Avoid duplicate events by checking for existing opportunity + stage
    const existing = await this.prisma.salesforceEvent.findFirst({
      where: {
        accountId: account.id,
        opportunityId: opp.externalId,
        stageName: opp.stage,
      },
    });

    if (existing) return; // Already recorded this stage

    await this.prisma.salesforceEvent.create({
      data: {
        accountId: account.id,
        eventType,
        stageName: opp.stage,
        opportunityId: opp.externalId,
        amount: opp.amount,
        closeDate: opp.closeDate,
        description: opp.name,
      },
    });
  }
}
