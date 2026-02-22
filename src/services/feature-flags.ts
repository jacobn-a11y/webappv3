import { Prisma, type PrismaClient } from "@prisma/client";

interface FeatureFlagOverrideShape {
  [environment: string]: Record<string, boolean>;
}

interface FeatureFlagOrgOverrideShape {
  [organizationId: string]: Record<string, boolean>;
}

export class FeatureFlagService {
  constructor(private prisma: PrismaClient) {}

  async isEnabled(
    organizationId: string,
    key: string,
    fallback = false
  ): Promise<boolean> {
    const override = this.getOverrideValue(organizationId, key);
    if (typeof override === "boolean") {
      return override;
    }
    const flag = await this.prisma.orgFeatureFlag.findUnique({
      where: { organizationId_key: { organizationId, key } },
      select: { enabled: true },
    });
    return flag?.enabled ?? fallback;
  }

  async list(organizationId: string) {
    return this.prisma.orgFeatureFlag.findMany({
      where: { organizationId },
      orderBy: { key: "asc" },
    });
  }

  async listResolved(organizationId: string) {
    const flags = await this.list(organizationId);
    return flags.map((flag) => {
      const override = this.getOverrideValue(organizationId, flag.key);
      return {
        ...flag,
        resolvedEnabled:
          typeof override === "boolean" ? override : flag.enabled,
        overrideSource:
          typeof override === "boolean"
            ? this.getOverrideSource(organizationId, flag.key)
            : null,
      };
    });
  }

  async getResolvedEnabledKeys(organizationId: string): Promise<string[]> {
    const flags = await this.listResolved(organizationId);
    return flags.filter((flag) => flag.resolvedEnabled).map((flag) => flag.key);
  }

  async upsert(params: {
    organizationId: string;
    key: string;
    enabled: boolean;
    config?: Record<string, unknown> | null;
  }) {
    return this.prisma.orgFeatureFlag.upsert({
      where: {
        organizationId_key: {
          organizationId: params.organizationId,
          key: params.key,
        },
      },
      create: {
        organizationId: params.organizationId,
        key: params.key,
        enabled: params.enabled,
        config: (params.config ?? undefined) as Prisma.InputJsonValue | undefined,
      },
      update: {
        enabled: params.enabled,
        config: (params.config ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }

  private getOverrideSource(organizationId: string, key: string): string | null {
    const orgOverrides = this.readOrgOverrides();
    if (orgOverrides[organizationId]?.[key] !== undefined) {
      return "org_override";
    }
    const env = process.env.DEPLOY_ENV || process.env.NODE_ENV || "development";
    const envOverrides = this.readEnvOverrides();
    if (envOverrides[env]?.[key] !== undefined) {
      return `env_override:${env}`;
    }
    return null;
  }

  private getOverrideValue(
    organizationId: string,
    key: string
  ): boolean | undefined {
    const orgOverrides = this.readOrgOverrides();
    const orgValue = orgOverrides[organizationId]?.[key];
    if (typeof orgValue === "boolean") {
      return orgValue;
    }

    const env = process.env.DEPLOY_ENV || process.env.NODE_ENV || "development";
    const envOverrides = this.readEnvOverrides();
    const envValue = envOverrides[env]?.[key];
    if (typeof envValue === "boolean") {
      return envValue;
    }

    return undefined;
  }

  private readEnvOverrides(): FeatureFlagOverrideShape {
    const raw = process.env.FEATURE_FLAG_ENV_OVERRIDES_JSON;
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      return parsed as FeatureFlagOverrideShape;
    } catch {
      return {};
    }
  }

  private readOrgOverrides(): FeatureFlagOrgOverrideShape {
    const raw = process.env.FEATURE_FLAG_ORG_OVERRIDES_JSON;
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      return parsed as FeatureFlagOrgOverrideShape;
    } catch {
      return {};
    }
  }
}
