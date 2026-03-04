import type { PrismaClient, IntegrationProvider } from "@prisma/client";
import { decodeCredentials } from "../types/json-boundaries.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface IntegrationConfigSummary {
  id: string;
  provider: string;
  enabled: boolean;
  status: string;
  lastSyncAt: Date | null;
  lastError: string | null;
  settings: unknown;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class IntegrationConfigService {
  constructor(private prisma: PrismaClient) {}

  async listConfigs(organizationId: string): Promise<IntegrationConfigSummary[]> {
    return this.prisma.integrationConfig.findMany({
      where: { organizationId },
      select: {
        id: true,
        provider: true,
        enabled: true,
        status: true,
        lastSyncAt: true,
        lastError: true,
        settings: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async getConfig(organizationId: string, provider: IntegrationProvider) {
    return this.prisma.integrationConfig.findUnique({
      where: {
        organizationId_provider: { organizationId, provider },
      },
    });
  }

  async createConfig(params: {
    organizationId: string;
    provider: IntegrationProvider;
    credentials: object;
    settings?: object;
    webhookSecret?: string;
  }) {
    return this.prisma.integrationConfig.create({
      data: {
        organizationId: params.organizationId,
        provider: params.provider,
        credentials: params.credentials,
        settings: params.settings,
        webhookSecret: params.webhookSecret,
        status: "PENDING_SETUP",
      },
    });
  }

  async updateConfig(
    organizationId: string,
    provider: IntegrationProvider,
    updateData: Record<string, unknown>
  ) {
    return this.prisma.integrationConfig.update({
      where: {
        organizationId_provider: { organizationId, provider },
      },
      data: updateData,
    });
  }

  async deleteConfig(organizationId: string, provider: IntegrationProvider): Promise<void> {
    await this.prisma.integrationConfig.delete({
      where: {
        organizationId_provider: { organizationId, provider },
      },
    });
  }

  async getDecryptedCredentials(
    organizationId: string,
    provider: IntegrationProvider
  ): Promise<Record<string, unknown> | null> {
    const config = await this.getConfig(organizationId, provider);
    if (!config) return null;
    return decodeCredentials(config.credentials);
  }

  async setConfigStatus(
    configId: string,
    status: string,
    lastError: string | null
  ): Promise<void> {
    await this.prisma.integrationConfig.update({
      where: { id: configId },
      data: { status, lastError },
    });
  }

  async listRuns(
    organizationId: string,
    filters: { status?: string; provider?: IntegrationProvider },
    limit: number
  ) {
    return this.prisma.integrationRun.findMany({
      where: {
        organizationId,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.provider ? { provider: filters.provider } : {}),
      },
      orderBy: { startedAt: "desc" },
      take: limit,
    });
  }

  async listFailedRuns(
    organizationId: string,
    provider: IntegrationProvider | undefined,
    limit: number
  ) {
    return this.prisma.integrationRun.findMany({
      where: {
        organizationId,
        status: "FAILED",
        ...(provider ? { provider } : {}),
      },
      orderBy: { startedAt: "desc" },
      take: limit,
    });
  }

  async listBackfillRuns(
    organizationId: string,
    provider: IntegrationProvider | undefined,
    limit: number
  ) {
    return this.prisma.integrationRun.findMany({
      where: {
        organizationId,
        runType: "BACKFILL",
        ...(provider ? { provider } : {}),
      },
      orderBy: { startedAt: "desc" },
      take: limit,
    });
  }
}
