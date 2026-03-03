import { Prisma } from "@prisma/client";
import type { Response } from "express";
import { respondAuthRequired, respondServerError } from "../_shared/errors.js";
import { parseRequestBody } from "../_shared/validators.js";
import { toProviderCredentials } from "../../integrations/types.js";
import { asObject, parseGongKeyBundle } from "./helpers.js";
import {
  MvpIndexAccountsSchema,
  MvpQuickstartSaveSchema,
  MvpSelectAccountsSchema,
} from "./schemas.js";
import type { AuthReq, SetupRouteContext } from "./types.js";

export function registerSetupQuickstartRoutes({
  deps,
  gongProvider,
  prisma,
  requireSetupAdmin,
  router,
}: Pick<
  SetupRouteContext,
  "deps" | "gongProvider" | "prisma" | "requireSetupAdmin" | "router"
>): void {
  const buildMvpQuickstartStatus = async (organizationId: string) => {
    const [gongIntegration, openaiConfig] = await Promise.all([
      prisma.integrationConfig.findUnique({
        where: {
          organizationId_provider: {
            organizationId,
            provider: "GONG",
          },
        },
      }),
      prisma.aIProviderConfig.findUnique({
        where: {
          organizationId_provider: {
            organizationId,
            provider: "OPENAI",
          },
        },
      }),
    ]);

    const settings = asObject(gongIntegration?.settings);
    const accountIndex = asObject(settings.gong_account_index);
    const indexedAccounts = Array.isArray(accountIndex.accounts)
      ? accountIndex.accounts
          .map((row) => {
            if (!row || typeof row !== "object") return null;
            const r = row as Record<string, unknown>;
            const name = String(r.name ?? "").trim();
            const count = Number(r.count ?? 0);
            if (!name) return null;
            return {
              name,
              count: Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0,
            };
          })
          .filter((row): row is { name: string; count: number } => Boolean(row))
      : [];

    const selectedAccounts = Array.isArray(settings.gong_selected_accounts)
      ? settings.gong_selected_accounts
          .map((value) => String(value ?? "").trim())
          .filter(Boolean)
      : [];

    const credentials = asObject(gongIntegration?.credentials);
    const hasGongCreds = Boolean(
      String(credentials.accessKey ?? "").trim() &&
        String(credentials.accessKeySecret ?? "").trim()
    );

    return {
      gong_configured: hasGongCreds && Boolean(gongIntegration?.enabled),
      gong_base_url:
        String(credentials.baseUrl ?? "").trim() || "https://api.gong.io",
      gong_status: gongIntegration?.status ?? "PENDING_SETUP",
      gong_last_sync_at: gongIntegration?.lastSyncAt?.toISOString() ?? null,
      gong_last_error: gongIntegration?.lastError ?? null,
      openai_configured: Boolean(openaiConfig?.isActive),
      selected_account_names: selectedAccounts,
      account_index: {
        generated_at:
          typeof accountIndex.generatedAt === "string"
            ? accountIndex.generatedAt
            : null,
        total_calls_indexed: Number(accountIndex.totalCallsIndexed ?? 0) || 0,
        total_accounts: indexedAccounts.length,
        accounts: indexedAccounts,
      },
    };
  };

  router.get("/mvp/quickstart", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      respondAuthRequired(res);
      return;
    }
    if (!requireSetupAdmin(req, res)) return;

    try {
      const status = await buildMvpQuickstartStatus(req.organizationId);
      res.json(status);
    } catch (err) {
      respondServerError(
        res,
        "MVP quickstart status error:",
        "Failed to load MVP quickstart status",
        err
      );
    }
  });

  router.post("/mvp/quickstart", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      respondAuthRequired(res);
      return;
    }
    if (!requireSetupAdmin(req, res)) return;
    if (!deps.aiConfigService) {
      res.status(500).json({ error: "AI config service unavailable" });
      return;
    }

    const payload = parseRequestBody(MvpQuickstartSaveSchema, req.body, res);
    if (!payload) {
      return;
    }

    const gongBundle = parseGongKeyBundle(payload.gong_api_key);
    if (!gongBundle) {
      res.status(400).json({
        error:
          "Invalid Gong API key format. Use `accessKey:accessKeySecret` or `Basic <base64(accessKey:accessKeySecret)>`.",
      });
      return;
    }

    try {
      const valid = await gongProvider.validateCredentials({
        accessKey: gongBundle.accessKey,
        accessKeySecret: gongBundle.accessKeySecret,
        baseUrl: payload.gong_base_url?.trim() || "https://api.gong.io",
      });

      if (!valid) {
        res.status(400).json({
          error: "Gong credentials validation failed. Check your Gong API key.",
        });
        return;
      }

      const existing = await prisma.integrationConfig.findUnique({
        where: {
          organizationId_provider: {
            organizationId: req.organizationId,
            provider: "GONG",
          },
        },
      });

      const preservedSettings = asObject(existing?.settings);

      await prisma.integrationConfig.upsert({
        where: {
          organizationId_provider: {
            organizationId: req.organizationId,
            provider: "GONG",
          },
        },
        create: {
          organizationId: req.organizationId,
          provider: "GONG",
          enabled: true,
          status: "ACTIVE",
          credentials: {
            accessKey: gongBundle.accessKey,
            accessKeySecret: gongBundle.accessKeySecret,
            baseUrl: payload.gong_base_url?.trim() || "https://api.gong.io",
          },
          settings: preservedSettings as Prisma.InputJsonValue,
          lastError: null,
        },
        update: {
          enabled: true,
          status: "ACTIVE",
          credentials: {
            accessKey: gongBundle.accessKey,
            accessKeySecret: gongBundle.accessKeySecret,
            baseUrl: payload.gong_base_url?.trim() || "https://api.gong.io",
          },
          settings: preservedSettings as Prisma.InputJsonValue,
          lastError: null,
        },
      });

      await deps.aiConfigService.upsertOrgConfig(req.organizationId, {
        provider: "openai",
        apiKey: payload.openai_api_key,
        displayName: "OpenAI",
        defaultModel: "gpt-4o",
        isDefault: true,
      });

      await prisma.orgAISettings.upsert({
        where: { organizationId: req.organizationId },
        create: {
          organizationId: req.organizationId,
          defaultProvider: "openai",
          defaultModel: "gpt-4o",
        },
        update: {
          defaultProvider: "openai",
          defaultModel: "gpt-4o",
        },
      });

      const status = await buildMvpQuickstartStatus(req.organizationId);
      res.json({ saved: true, status });
    } catch (err) {
      respondServerError(
        res,
        "MVP quickstart save error:",
        "Failed to save MVP quickstart keys",
        err
      );
    }
  });

  router.post(
    "/mvp/quickstart/gong/accounts/index",
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        respondAuthRequired(res);
        return;
      }
      if (!requireSetupAdmin(req, res)) return;

      const payload = parseRequestBody(MvpIndexAccountsSchema, req.body ?? {}, res);
      if (!payload) {
        return;
      }

      try {
        const config = await prisma.integrationConfig.findUnique({
          where: {
            organizationId_provider: {
              organizationId: req.organizationId,
              provider: "GONG",
            },
          },
        });
        if (!config) {
          res.status(404).json({
            error: "Gong is not configured yet. Save your Gong key first.",
          });
          return;
        }

        const settings = asObject(config.settings);
        const existingIndex = asObject(settings.gong_account_index);
        const cachedAccounts = Array.isArray(existingIndex.accounts)
          ? existingIndex.accounts
          : [];
        const hasCachedIndex =
          cachedAccounts.length > 0 && typeof existingIndex.generatedAt === "string";

        if (!payload.refresh && hasCachedIndex) {
          res.json({
            generated_at: existingIndex.generatedAt,
            total_calls_indexed: Number(existingIndex.totalCallsIndexed ?? 0) || 0,
            accounts: cachedAccounts,
            total_accounts: cachedAccounts.length,
            cached: true,
          });
          return;
        }

        const credentials = asObject(config.credentials);
        const indexResult = await gongProvider.fetchAccountIndex(
          toProviderCredentials(credentials),
          {
            maxScanCalls: payload.max_scan_calls ?? 0,
            // Preserve existing API contract defaults.
            since: null,
          }
        );

        const nextSettings = {
          ...settings,
          gong_account_index: {
            generatedAt: indexResult.generatedAt,
            totalCallsIndexed: indexResult.totalCallsIndexed,
            accounts: indexResult.accounts,
          },
        };

        await prisma.integrationConfig.update({
          where: { id: config.id },
          data: { settings: nextSettings as Prisma.InputJsonValue },
        });

        res.json({
          generated_at: indexResult.generatedAt,
          total_calls_indexed: indexResult.totalCallsIndexed,
          accounts: indexResult.accounts,
          total_accounts: indexResult.totalAccounts,
          cached: false,
        });
      } catch (err) {
        console.error("MVP Gong account index error:", err);
        res.status(500).json({ error: "Failed to index Gong accounts" });
      }
    }
  );

  router.post(
    "/mvp/quickstart/gong/accounts/selection",
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        respondAuthRequired(res);
        return;
      }
      if (!requireSetupAdmin(req, res)) return;

      const payload = parseRequestBody(MvpSelectAccountsSchema, req.body, res);
      if (!payload) {
        return;
      }

      try {
        const config = await prisma.integrationConfig.findUnique({
          where: {
            organizationId_provider: {
              organizationId: req.organizationId,
              provider: "GONG",
            },
          },
        });
        if (!config) {
          res.status(404).json({
            error: "Gong is not configured yet. Save your Gong key first.",
          });
          return;
        }

        const selected = Array.from(
          new Set(
            payload.account_names
              .map((name) => String(name ?? "").trim())
              .filter(Boolean)
          )
        ).sort((a, b) => a.localeCompare(b));

        const settings = asObject(config.settings);
        const nextSettings = {
          ...settings,
          gong_selected_accounts: selected,
        };

        const updatedConfig = await prisma.integrationConfig.update({
          where: { id: config.id },
          data: {
            settings: nextSettings as Prisma.InputJsonValue,
            status: "ACTIVE",
            enabled: true,
            lastError: null,
          },
        });

        const shouldTriggerIngest = payload.trigger_ingest ?? true;
        let idempotencyKey: string | null = null;

        if (shouldTriggerIngest && deps.syncEngine) {
          idempotencyKey = `mvp-quickstart:${updatedConfig.id}:${Date.now()}`;
          deps.syncEngine
            .syncIntegration(updatedConfig, {
              runType: "BACKFILL",
              idempotencyKey,
              sinceOverride: new Date("2000-01-01T00:00:00.000Z"),
              cursorOverride: null,
            })
            .catch((err) => {
              console.error("MVP quickstart ingest failed:", err);
            });
        }

        res.json({
          saved: true,
          selected_account_names: selected,
          ingest_started: Boolean(shouldTriggerIngest && deps.syncEngine),
          idempotency_key: idempotencyKey,
        });
      } catch (err) {
        console.error("MVP Gong account selection error:", err);
        res.status(500).json({ error: "Failed to save Gong account selection" });
      }
    }
  );
}
