/**
 * AI Configuration Service
 *
 * Resolves the correct AI client for any request by considering:
 *   1. Platform-level providers (app owner's API keys + pricing)
 *   2. Org-level settings (PLATFORM vs CUSTOM source)
 *   3. Per-role defaults (allowed providers/models per role)
 *   4. Per-user overrides (individual provider/model restrictions)
 *
 * Key rule: when an org uses CUSTOM (own API keys), their users are
 * exclusively routed through the org's keys. They cannot fall back to
 * platform AI.
 *
 * API keys are encrypted at rest with AES-256-GCM.
 */

import crypto from "crypto";
import type { PrismaClient, AIProviderType, UserRole } from "@prisma/client";
import {
  createAIClient,
  type AIClient,
  type AIProviderName,
} from "./ai-client.js";

// ─── Encryption ──────────────────────────────────────────────────────────────

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const secret = process.env.AI_KEY_ENCRYPTION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "AI_KEY_ENCRYPTION_SECRET must be set (at least 32 characters). " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptApiKey(plaintext: string): {
  encrypted: string;
  iv: string;
  authTag: string;
} {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");

  return { encrypted, iv: iv.toString("hex"), authTag };
}

export function decryptApiKey(
  encrypted: string,
  iv: string,
  authTag: string
): string {
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(iv, "hex")
  );
  decipher.setAuthTag(Buffer.from(authTag, "hex"));

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

// ─── Provider Type Mapping ───────────────────────────────────────────────────

export function toProviderName(prismaType: AIProviderType): AIProviderName {
  const map: Record<AIProviderType, AIProviderName> = {
    OPENAI: "openai",
    ANTHROPIC: "anthropic",
    GOOGLE: "google",
  };
  return map[prismaType];
}

export function toPrismaType(name: AIProviderName): AIProviderType {
  const map: Record<AIProviderName, AIProviderType> = {
    openai: "OPENAI",
    anthropic: "ANTHROPIC",
    google: "GOOGLE",
  };
  return map[name];
}

// ─── Access Resolution Types ─────────────────────────────────────────────────

export interface ResolvedAccess {
  allowedProviders: AIProviderName[];
  allowedModels: string[];
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class AIConfigService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Resolves the AIClient for a request, respecting:
   *   - Per-provider source (org's own key vs platform key)
   *   - User's allowed providers/models
   *   - Optional overrides for provider/model
   *
   * Returns the client AND whether platform billing applies.
   * Platform billing applies when the org does NOT have their own API key
   * for the requested provider. If they do have their own key, it's always
   * used — they cannot fall back to the platform for that provider.
   */
  async resolveClient(
    organizationId: string,
    userId: string,
    userRole: UserRole,
    overrides?: { provider?: AIProviderName; model?: string }
  ): Promise<{ client: AIClient; isPlatformBilled: boolean }> {
    const orgSettings = await this.prisma.orgAISettings.findUnique({
      where: { organizationId },
    });

    // Resolve what the user is allowed to use
    const access = await this.resolveUserAccess(
      organizationId,
      userId,
      userRole
    );

    // Determine the target provider and model
    const targetProvider =
      overrides?.provider ??
      (orgSettings?.defaultProvider as AIProviderName | null) ??
      (access.allowedProviders[0] ?? "openai");

    const targetModel = overrides?.model ?? orgSettings?.defaultModel ?? undefined;

    // Validate the user has access to this provider
    if (
      access.allowedProviders.length > 0 &&
      !access.allowedProviders.includes(targetProvider)
    ) {
      throw new AIAccessDeniedError(
        `You don't have access to the "${targetProvider}" AI provider. ` +
          `Allowed providers: ${access.allowedProviders.join(", ")}`
      );
    }

    // Validate model access if specific models are restricted
    if (
      targetModel &&
      access.allowedModels.length > 0 &&
      !access.allowedModels.includes(targetModel)
    ) {
      throw new AIAccessDeniedError(
        `You don't have access to the "${targetModel}" model. ` +
          `Allowed models: ${access.allowedModels.join(", ")}`
      );
    }

    // Per-provider resolution: check if org has their own key for this provider
    const orgConfig = await this.prisma.aIProviderConfig.findUnique({
      where: {
        organizationId_provider: {
          organizationId,
          provider: toPrismaType(targetProvider),
        },
      },
    });

    if (orgConfig && orgConfig.isActive) {
      // Org has their own key for this provider — use it, no platform billing
      const client = await this.resolveCustomClient(
        organizationId,
        targetProvider,
        targetModel
      );
      return { client, isPlatformBilled: false };
    }

    // No org key for this provider — use platform key, platform billing applies
    const client = await this.resolvePlatformClient(targetProvider, targetModel);
    return { client, isPlatformBilled: true };
  }

  /**
   * Resolves what providers and models a user is allowed to access.
   * Resolution order: user override > role default > all available.
   */
  async resolveUserAccess(
    organizationId: string,
    userId: string,
    userRole: UserRole
  ): Promise<ResolvedAccess> {
    // OWNER and ADMIN always have full access
    if (userRole === "OWNER" || userRole === "ADMIN") {
      return { allowedProviders: [], allowedModels: [] }; // empty = all
    }

    // Check for per-user override
    const userAccess = await this.prisma.userAIAccess.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
    });

    if (userAccess) {
      let providers = userAccess.allowedProviders.map(toProviderName);
      let models = [...userAccess.allowedModels];

      // Apply denials
      if (userAccess.deniedProviders.length > 0) {
        const denied = new Set(userAccess.deniedProviders.map(toProviderName));
        providers = providers.filter((p) => !denied.has(p));
      }
      if (userAccess.deniedModels.length > 0) {
        const denied = new Set(userAccess.deniedModels);
        models = models.filter((m) => !denied.has(m));
      }

      return { allowedProviders: providers, allowedModels: models };
    }

    // Fall back to role defaults
    const roleDefault = await this.prisma.orgAIRoleDefault.findUnique({
      where: { organizationId_role: { organizationId, role: userRole } },
    });

    if (roleDefault) {
      return {
        allowedProviders: roleDefault.allowedProviders.map(toProviderName),
        allowedModels: [...roleDefault.allowedModels],
      };
    }

    // No restrictions configured
    return { allowedProviders: [], allowedModels: [] };
  }

  // ─── Platform Client Resolution ────────────────────────────────────

  private async resolvePlatformClient(
    provider: AIProviderName,
    model?: string
  ): Promise<AIClient> {
    const platformProvider = await this.prisma.platformAIProvider.findUnique({
      where: { provider: toPrismaType(provider) },
    });

    if (!platformProvider || !platformProvider.isActive) {
      throw new Error(
        `Platform AI provider "${provider}" is not available. ` +
          "Contact the platform administrator."
      );
    }

    const apiKey = decryptApiKey(
      platformProvider.encryptedApiKey,
      platformProvider.keyIv,
      platformProvider.keyAuthTag
    );

    // If a model is specified, verify it's available at platform pricing
    if (model) {
      const pricing = await this.prisma.platformModelPricing.findUnique({
        where: {
          provider_modelId: {
            provider: toPrismaType(provider),
            modelId: model,
          },
        },
      });

      if (pricing && !pricing.isAvailable) {
        throw new Error(`Model "${model}" is currently unavailable.`);
      }
    }

    return createAIClient(provider, apiKey, model);
  }

  // ─── Custom (Org) Client Resolution ────────────────────────────────

  private async resolveCustomClient(
    organizationId: string,
    provider: AIProviderName,
    model?: string
  ): Promise<AIClient> {
    const config = await this.prisma.aIProviderConfig.findUnique({
      where: {
        organizationId_provider: {
          organizationId,
          provider: toPrismaType(provider),
        },
      },
    });

    if (!config || !config.isActive) {
      throw new Error(
        `AI provider "${provider}" is not configured for your organization. ` +
          "Ask your admin to add it in AI Settings."
      );
    }

    const apiKey = decryptApiKey(
      config.encryptedApiKey,
      config.keyIv,
      config.keyAuthTag
    );

    return createAIClient(
      provider,
      apiKey,
      model ?? config.defaultModel ?? undefined
    );
  }

  // ─── Org Config Management (admin) ─────────────────────────────────

  async listOrgConfigs(organizationId: string) {
    const configs = await this.prisma.aIProviderConfig.findMany({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
    });

    return configs.map((c) => ({
      id: c.id,
      provider: toProviderName(c.provider),
      displayName: c.displayName,
      defaultModel: c.defaultModel,
      embeddingModel: c.embeddingModel,
      isDefault: c.isDefault,
      isActive: c.isActive,
      apiKeyPreview: maskEncryptedKey(c),
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }));
  }

  async upsertOrgConfig(
    organizationId: string,
    input: {
      provider: AIProviderName;
      apiKey: string;
      displayName?: string;
      defaultModel?: string;
      embeddingModel?: string;
      isDefault?: boolean;
    }
  ): Promise<string> {
    const { encrypted, iv, authTag } = encryptApiKey(input.apiKey);
    const prismaProvider = toPrismaType(input.provider);

    if (input.isDefault) {
      await this.prisma.aIProviderConfig.updateMany({
        where: { organizationId, isDefault: true },
        data: { isDefault: false },
      });
    }

    const config = await this.prisma.aIProviderConfig.upsert({
      where: {
        organizationId_provider: {
          organizationId,
          provider: prismaProvider,
        },
      },
      create: {
        organizationId,
        provider: prismaProvider,
        encryptedApiKey: encrypted,
        keyIv: iv,
        keyAuthTag: authTag,
        displayName: input.displayName ?? null,
        defaultModel: input.defaultModel ?? null,
        embeddingModel: input.embeddingModel ?? null,
        isDefault: input.isDefault ?? false,
        isActive: true,
      },
      update: {
        encryptedApiKey: encrypted,
        keyIv: iv,
        keyAuthTag: authTag,
        displayName: input.displayName,
        defaultModel: input.defaultModel,
        embeddingModel: input.embeddingModel,
        isDefault: input.isDefault,
      },
    });

    return config.id;
  }

  async deleteOrgConfig(
    organizationId: string,
    provider: AIProviderName
  ): Promise<void> {
    await this.prisma.aIProviderConfig.deleteMany({
      where: { organizationId, provider: toPrismaType(provider) },
    });
  }

  // ─── Platform Config Management (platform admin) ───────────────────

  async listPlatformProviders() {
    const providers = await this.prisma.platformAIProvider.findMany({
      include: { models: { orderBy: { sortOrder: "asc" } } },
      orderBy: { createdAt: "asc" },
    });

    return providers.map((p) => ({
      id: p.id,
      provider: toProviderName(p.provider),
      isActive: p.isActive,
      apiKeyPreview: maskEncryptedKey(p),
      models: p.models.map((m) => ({
        id: m.id,
        modelId: m.modelId,
        displayName: m.displayName,
        inputCostPer1kTokens: m.inputCostPer1kTokens,
        outputCostPer1kTokens: m.outputCostPer1kTokens,
        isAvailable: m.isAvailable,
        sortOrder: m.sortOrder,
      })),
    }));
  }

  async upsertPlatformProvider(input: {
    provider: AIProviderName;
    apiKey: string;
    isActive?: boolean;
  }): Promise<string> {
    const { encrypted, iv, authTag } = encryptApiKey(input.apiKey);
    const prismaProvider = toPrismaType(input.provider);

    const p = await this.prisma.platformAIProvider.upsert({
      where: { provider: prismaProvider },
      create: {
        provider: prismaProvider,
        encryptedApiKey: encrypted,
        keyIv: iv,
        keyAuthTag: authTag,
        isActive: input.isActive ?? true,
      },
      update: {
        encryptedApiKey: encrypted,
        keyIv: iv,
        keyAuthTag: authTag,
        isActive: input.isActive,
      },
    });

    return p.id;
  }

  async upsertModelPricing(input: {
    provider: AIProviderName;
    modelId: string;
    displayName: string;
    inputCostPer1kTokens: number;
    outputCostPer1kTokens: number;
    isAvailable?: boolean;
    sortOrder?: number;
  }): Promise<string> {
    const prismaProvider = toPrismaType(input.provider);

    // Ensure the platform provider exists
    const platformProvider = await this.prisma.platformAIProvider.findUnique({
      where: { provider: prismaProvider },
    });

    if (!platformProvider) {
      throw new Error(
        `Platform provider "${input.provider}" must be configured before adding model pricing.`
      );
    }

    const pricing = await this.prisma.platformModelPricing.upsert({
      where: {
        provider_modelId: {
          provider: prismaProvider,
          modelId: input.modelId,
        },
      },
      create: {
        platformProviderId: platformProvider.id,
        provider: prismaProvider,
        modelId: input.modelId,
        displayName: input.displayName,
        inputCostPer1kTokens: input.inputCostPer1kTokens,
        outputCostPer1kTokens: input.outputCostPer1kTokens,
        isAvailable: input.isAvailable ?? true,
        sortOrder: input.sortOrder ?? 0,
      },
      update: {
        displayName: input.displayName,
        inputCostPer1kTokens: input.inputCostPer1kTokens,
        outputCostPer1kTokens: input.outputCostPer1kTokens,
        isAvailable: input.isAvailable,
        sortOrder: input.sortOrder,
      },
    });

    return pricing.id;
  }

  async deleteModelPricing(
    provider: AIProviderName,
    modelId: string
  ): Promise<void> {
    await this.prisma.platformModelPricing.deleteMany({
      where: { provider: toPrismaType(provider), modelId },
    });
  }

  /**
   * Returns pricing for a specific model. Used to calculate costs after AI calls.
   */
  async getModelPricing(
    provider: AIProviderName,
    modelId: string
  ): Promise<{ inputCostPer1kTokens: number; outputCostPer1kTokens: number } | null> {
    const pricing = await this.prisma.platformModelPricing.findUnique({
      where: {
        provider_modelId: {
          provider: toPrismaType(provider),
          modelId,
        },
      },
    });

    if (!pricing) return null;

    return {
      inputCostPer1kTokens: pricing.inputCostPer1kTokens,
      outputCostPer1kTokens: pricing.outputCostPer1kTokens,
    };
  }

  /**
   * Lists all available platform models (for user-facing model selector).
   */
  async listAvailablePlatformModels() {
    const models = await this.prisma.platformModelPricing.findMany({
      where: { isAvailable: true },
      include: {
        platformProvider: { select: { isActive: true } },
      },
      orderBy: [{ provider: "asc" }, { sortOrder: "asc" }],
    });

    return models
      .filter((m) => m.platformProvider.isActive)
      .map((m) => ({
        provider: toProviderName(m.provider),
        modelId: m.modelId,
        displayName: m.displayName,
        inputCostPer1kTokens: m.inputCostPer1kTokens,
        outputCostPer1kTokens: m.outputCostPer1kTokens,
      }));
  }

  /**
   * Validates an API key by making a minimal test call.
   */
  async validateApiKey(
    provider: AIProviderName,
    apiKey: string
  ): Promise<{ valid: boolean; error?: string }> {
    try {
      const client = createAIClient(provider, apiKey);
      await client.chatCompletion({
        messages: [{ role: "user", content: "Hello" }],
        maxTokens: 5,
        temperature: 0,
      });
      return { valid: true };
    } catch (err) {
      return {
        valid: false,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function maskEncryptedKey(config: {
  encryptedApiKey: string;
  keyIv: string;
  keyAuthTag: string;
}): string {
  try {
    const key = decryptApiKey(
      config.encryptedApiKey,
      config.keyIv,
      config.keyAuthTag
    );
    if (key.length <= 8) return "****";
    return key.slice(0, 4) + "..." + key.slice(-4);
  } catch {
    return "****";
  }
}

// ─── Custom Errors ───────────────────────────────────────────────────────────

export class AIAccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIAccessDeniedError";
  }
}
