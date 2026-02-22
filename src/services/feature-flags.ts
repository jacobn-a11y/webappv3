import { Prisma, type PrismaClient } from "@prisma/client";

export class FeatureFlagService {
  constructor(private prisma: PrismaClient) {}

  private get delegate(): {
    findUnique: (args: unknown) => Promise<{ enabled: boolean } | null>;
    findMany: (args: unknown) => Promise<
      Array<{
        id: string;
        key: string;
        enabled: boolean;
        config: unknown;
        createdAt: Date;
        updatedAt: Date;
      }>
    >;
    upsert: (args: unknown) => Promise<{
      id: string;
      key: string;
      enabled: boolean;
      config: unknown;
    }>;
  } {
    return (
      this.prisma as unknown as {
        orgFeatureFlag: {
          findUnique: (args: unknown) => Promise<{ enabled: boolean } | null>;
          findMany: (args: unknown) => Promise<
            Array<{
              id: string;
              key: string;
              enabled: boolean;
              config: unknown;
              createdAt: Date;
              updatedAt: Date;
            }>
          >;
          upsert: (args: unknown) => Promise<{
            id: string;
            key: string;
            enabled: boolean;
            config: unknown;
          }>;
        };
      }
    ).orgFeatureFlag;
  }

  async isEnabled(
    organizationId: string,
    key: string,
    fallback = false
  ): Promise<boolean> {
    const flag = await this.delegate.findUnique({
      where: { organizationId_key: { organizationId, key } },
      select: { enabled: true },
    });
    return flag?.enabled ?? fallback;
  }

  async list(organizationId: string) {
    return this.delegate.findMany({
      where: { organizationId },
      orderBy: { key: "asc" },
    });
  }

  async upsert(params: {
    organizationId: string;
    key: string;
    enabled: boolean;
    config?: Record<string, unknown> | null;
  }) {
    return this.delegate.upsert({
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
}
