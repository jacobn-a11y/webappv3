/**
 * Connections Setup Wizard Routes
 *
 * First-run onboarding flow for new organizations:
 *
 *   GET  /api/setup/status                    — Current wizard state
 *   POST /api/setup/step/recording-provider   — Step 1: Init Merge.dev Link for recordings
 *   POST /api/setup/step/recording-provider/complete — Step 1: Complete after Merge Link
 *   POST /api/setup/step/crm                  — Step 2: Init Merge.dev Link for CRM
 *   POST /api/setup/step/crm/complete         — Step 2: Complete after CRM Link
 *   GET  /api/setup/step/account-sync         — Step 3: Preview account sync
 *   POST /api/setup/step/account-sync/resolve — Step 3: Fix entity resolution mismatches
 *   POST /api/setup/step/account-sync/complete — Step 3: Mark sync review done
 *   GET  /api/setup/step/plan                 — Step 4: List available plans
 *   POST /api/setup/step/plan                 — Step 4: Choose plan
 *   POST /api/setup/step/permissions          — Step 5: Set default permissions
 *   POST /api/setup/skip                      — Skip the current step
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { Prisma, type PrismaClient, type UserRole, type CallProvider, type CRMProvider, type Plan } from "@prisma/client";
import Stripe from "stripe";
import { SetupWizardService } from "../services/setup-wizard.js";
import { RoleProfileService } from "../services/role-profiles.js";
import type { AIConfigService } from "../services/ai-config.js";
import type { SyncEngine } from "../integrations/sync-engine.js";
import { GongProvider } from "../integrations/gong-provider.js";
import type { ProviderCredentials } from "../integrations/types.js";
import { isBillingEnabled } from "../middleware/billing.js";
import { getStripePriceId } from "../config/stripe-plans.js";
import { buildPublicAppUrl } from "../lib/public-app-url.js";

// ─── Validation Schemas ──────────────────────────────────────────────────────

const CompleteRecordingProviderSchema = z.object({
  provider: z.enum([
    "GONG", "CHORUS", "ZOOM", "GOOGLE_MEET", "TEAMS",
    "FIREFLIES", "DIALPAD", "AIRCALL", "RINGCENTRAL",
    "SALESLOFT", "OUTREACH", "OTHER",
  ]),
  merge_linked_account_id: z.string().min(1),
});

const CompleteCrmSchema = z.object({
  crm_provider: z.enum(["SALESFORCE", "HUBSPOT"]),
  merge_linked_account_id: z.string().min(1),
});

const EntityResolutionFixSchema = z.object({
  fixes: z.array(
    z.object({
      call_id: z.string().min(1),
      account_id: z.string().min(1),
    })
  ),
});

const SelectPlanSchema = z.object({
  plan: z.enum(["FREE_TRIAL", "STARTER", "PROFESSIONAL", "ENTERPRISE"]),
});

const PermissionsSchema = z.object({
  default_page_visibility: z.enum(["PRIVATE", "SHARED_WITH_LINK"]),
  allowed_publishers: z.array(
    z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"])
  ),
  require_approval_to_publish: z.boolean(),
});

const OrgProfileSchema = z.object({
  company_overview: z.string().max(5000).optional(),
  products: z.array(z.string().min(1).max(200)).optional(),
  target_personas: z.array(z.string().min(1).max(120)).optional(),
  target_industries: z.array(z.string().min(1).max(120)).optional(),
});

const GovernanceDefaultsSchema = z.object({
  retention_days: z.number().int().min(30).max(3650).optional(),
  audit_log_retention_days: z.number().int().min(30).max(3650).optional(),
  legal_hold_enabled: z.boolean().optional(),
  pii_export_enabled: z.boolean().optional(),
  deletion_requires_approval: z.boolean().optional(),
  allow_named_story_exports: z.boolean().optional(),
  rto_target_minutes: z.number().int().min(5).max(60 * 24 * 14).optional(),
  rpo_target_minutes: z.number().int().min(5).max(60 * 24 * 14).optional(),
});

const SkipStepSchema = z.object({
  step: z.enum([
    "RECORDING_PROVIDER", "CRM", "ACCOUNT_SYNC", "PLAN", "PERMISSIONS",
  ]),
});

const MvpQuickstartSaveSchema = z.object({
  gong_api_key: z.string().min(1, "Gong API key is required"),
  openai_api_key: z.string().min(1, "OpenAI API key is required"),
  gong_base_url: z.string().url().optional(),
});

const MvpIndexAccountsSchema = z.object({
  refresh: z.boolean().optional(),
  max_scan_calls: z.number().int().min(0).max(200_000).optional(),
});

const MvpSelectAccountsSchema = z.object({
  account_names: z.array(z.string().min(1)).max(500),
  trigger_ingest: z.boolean().optional(),
});

// ─── Auth Request Type ───────────────────────────────────────────────────────

interface AuthReq extends Request {
  organizationId?: string;
  userId?: string;
  userRole?: UserRole;
}

interface SetupRouteDeps {
  aiConfigService?: AIConfigService;
  syncEngine?: SyncEngine;
}

interface ParsedGongKeyBundle {
  accessKey: string;
  accessKeySecret: string;
}

function parseGongKeyBundle(input: string): ParsedGongKeyBundle | null {
  const value = String(input ?? "").trim();
  if (!value) return null;

  const parsePair = (raw: string): ParsedGongKeyBundle | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const separator = trimmed.includes(":") ? ":" : trimmed.includes("|") ? "|" : null;
    if (!separator) return null;
    const idx = trimmed.indexOf(separator);
    const accessKey = trimmed.slice(0, idx).trim();
    const accessKeySecret = trimmed.slice(idx + 1).trim();
    if (!accessKey || !accessKeySecret) return null;
    return { accessKey, accessKeySecret };
  };

  if (value.toLowerCase().startsWith("basic ")) {
    const payload = value.slice(6).trim();
    try {
      const decoded = Buffer.from(payload, "base64").toString("utf8");
      const parsed = parsePair(decoded);
      if (parsed) return parsed;
    } catch {
      return null;
    }
  }

  if (value.startsWith("{") && value.endsWith("}")) {
    try {
      const parsedJson = JSON.parse(value) as {
        accessKey?: string;
        access_key?: string;
        key?: string;
        accessKeySecret?: string;
        access_key_secret?: string;
        secret?: string;
      };
      const accessKey =
        parsedJson.accessKey ?? parsedJson.access_key ?? parsedJson.key ?? "";
      const accessKeySecret =
        parsedJson.accessKeySecret ??
        parsedJson.access_key_secret ??
        parsedJson.secret ??
        "";
      if (String(accessKey).trim() && String(accessKeySecret).trim()) {
        return {
          accessKey: String(accessKey).trim(),
          accessKeySecret: String(accessKeySecret).trim(),
        };
      }
    } catch {
      return null;
    }
  }

  return parsePair(value);
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

// ─── Route Factory ───────────────────────────────────────────────────────────

export function createSetupRoutes(
  prisma: PrismaClient,
  stripe: Stripe,
  deps: SetupRouteDeps = {}
): Router {
  const router = Router();
  const wizardService = new SetupWizardService(prisma);
  const roleProfiles = new RoleProfileService(prisma);
  const gongProvider = new GongProvider();
  const requireSetupAdmin = (req: AuthReq, res: Response): boolean => {
    if (!req.userRole || (req.userRole !== "OWNER" && req.userRole !== "ADMIN")) {
      res.status(403).json({ error: "Admin access required" });
      return false;
    }
    return true;
  };

  // ── GET /api/setup/status ─────────────────────────────────────────

  /**
   * Returns the current wizard state for the authenticated org.
   * Use this to determine which step to show the user.
   */
  router.get("/status", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    try {
      const status = await wizardService.getStatus(req.organizationId);
      res.json(status);
    } catch (err) {
      console.error("Setup status error:", err);
      res.status(500).json({ error: "Failed to load setup status" });
    }
  });

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
        total_calls_indexed:
          Number(accountIndex.totalCallsIndexed ?? 0) || 0,
        total_accounts: indexedAccounts.length,
        accounts: indexedAccounts,
      },
    };
  };

  // ── MVP Quickstart: Gong + OpenAI ─────────────────────────────────────

  router.get("/mvp/quickstart", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (!requireSetupAdmin(req, res)) return;

    try {
      const status = await buildMvpQuickstartStatus(req.organizationId);
      res.json(status);
    } catch (err) {
      console.error("MVP quickstart status error:", err);
      res.status(500).json({ error: "Failed to load MVP quickstart status" });
    }
  });

  router.post("/mvp/quickstart", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (!requireSetupAdmin(req, res)) return;
    if (!deps.aiConfigService) {
      res.status(500).json({ error: "AI config service unavailable" });
      return;
    }

    const parse = MvpQuickstartSaveSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: "validation_error", details: parse.error.issues });
      return;
    }

    const gongBundle = parseGongKeyBundle(parse.data.gong_api_key);
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
        baseUrl: parse.data.gong_base_url?.trim() || "https://api.gong.io",
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
            baseUrl: parse.data.gong_base_url?.trim() || "https://api.gong.io",
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
            baseUrl: parse.data.gong_base_url?.trim() || "https://api.gong.io",
          },
          settings: preservedSettings as Prisma.InputJsonValue,
          lastError: null,
        },
      });

      await deps.aiConfigService.upsertOrgConfig(req.organizationId, {
        provider: "openai",
        apiKey: parse.data.openai_api_key,
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
      console.error("MVP quickstart save error:", err);
      res.status(500).json({ error: "Failed to save MVP quickstart keys" });
    }
  });

  router.post(
    "/mvp/quickstart/gong/accounts/index",
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }
      if (!requireSetupAdmin(req, res)) return;

      const parse = MvpIndexAccountsSchema.safeParse(req.body ?? {});
      if (!parse.success) {
        res.status(400).json({
          error: "validation_error",
          details: parse.error.issues,
        });
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
          cachedAccounts.length > 0 &&
          typeof existingIndex.generatedAt === "string";

        if (!parse.data.refresh && hasCachedIndex) {
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
          credentials as unknown as ProviderCredentials,
          {
            maxScanCalls: parse.data.max_scan_calls ?? 0,
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
        res.status(401).json({ error: "Authentication required" });
        return;
      }
      if (!requireSetupAdmin(req, res)) return;

      const parse = MvpSelectAccountsSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({
          error: "validation_error",
          details: parse.error.issues,
        });
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
            parse.data.account_names
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

        const shouldTriggerIngest = parse.data.trigger_ingest ?? true;
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

  // ── Step 1: Recording Provider ────────────────────────────────────

  /**
   * POST /api/setup/step/recording-provider
   *
   * Initiates the Merge.dev Link flow for connecting a recording provider.
   * Returns a link_token the frontend uses to open the Merge Link modal.
   */
  router.post(
    "/step/recording-provider",
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      try {
        const linkToken = await wizardService.initRecordingProviderLink(
          req.organizationId
        );
        res.json(linkToken);
      } catch (err) {
        console.error("Recording provider link error:", err);
        res.status(500).json({ error: "Failed to create Merge.dev link session" });
      }
    }
  );

  /**
   * POST /api/setup/step/recording-provider/complete
   *
   * Called after the user finishes the Merge Link flow for recordings.
   * Records the provider choice and linked account, then advances to Step 2.
   */
  router.post(
    "/step/recording-provider/complete",
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      const parse = CompleteRecordingProviderSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({
          error: "validation_error",
          details: parse.error.issues,
        });
        return;
      }

      try {
        await wizardService.completeRecordingProvider(
          req.organizationId,
          parse.data.provider as CallProvider,
          parse.data.merge_linked_account_id
        );

        const status = await wizardService.getStatus(req.organizationId);
        res.json({ completed: true, status });
      } catch (err) {
        console.error("Complete recording provider error:", err);
        res.status(500).json({ error: "Failed to complete recording provider setup" });
      }
    }
  );

  // ── Step 2: CRM Connection ────────────────────────────────────────

  /**
   * POST /api/setup/step/crm
   *
   * Initiates the Merge.dev Link flow for connecting a CRM (Salesforce or HubSpot).
   * Returns a link_token for the frontend.
   */
  router.post("/step/crm", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    try {
      const linkToken = await wizardService.initCrmLink(req.organizationId);
      res.json(linkToken);
    } catch (err) {
      console.error("CRM link error:", err);
      res.status(500).json({ error: "Failed to create Merge.dev CRM link session" });
    }
  });

  /**
   * POST /api/setup/step/crm/complete
   *
   * Called after the user finishes the CRM Merge Link flow.
   * Records the CRM provider and linked account, then advances to Step 3.
   */
  router.post("/step/crm/complete", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const parse = CompleteCrmSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({
        error: "validation_error",
        details: parse.error.issues,
      });
      return;
    }

    try {
      await wizardService.completeCrmConnection(
        req.organizationId,
        parse.data.crm_provider as CRMProvider,
        parse.data.merge_linked_account_id
      );

      const status = await wizardService.getStatus(req.organizationId);
      res.json({ completed: true, status });
    } catch (err) {
      console.error("Complete CRM error:", err);
      res.status(500).json({ error: "Failed to complete CRM setup" });
    }
  });

  // ── Step 3: Account Sync Review ───────────────────────────────────

  /**
   * GET /api/setup/step/account-sync
   *
   * Returns a preview of the initial account sync. Shows:
   *   - Total accounts synced from CRM
   *   - Calls matched to accounts (resolved)
   *   - Unmatched calls with suggested matches (for manual review)
   */
  router.get("/step/account-sync", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    try {
      const preview = await wizardService.getAccountSyncPreview(
        req.organizationId
      );
      res.json(preview);
    } catch (err) {
      console.error("Account sync preview error:", err);
      res.status(500).json({ error: "Failed to load account sync preview" });
    }
  });

  /**
   * POST /api/setup/step/account-sync/resolve
   *
   * Applies manual entity resolution fixes. The user maps unmatched calls
   * to the correct accounts.
   */
  router.post(
    "/step/account-sync/resolve",
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      const parse = EntityResolutionFixSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({
          error: "validation_error",
          details: parse.error.issues,
        });
        return;
      }

      try {
        const result = await wizardService.applyEntityResolutionFixes(
          req.organizationId,
          parse.data.fixes.map((f) => ({
            callId: f.call_id,
            accountId: f.account_id,
          }))
        );
        res.json(result);
      } catch (err) {
        console.error("Entity resolution fix error:", err);
        res.status(500).json({ error: "Failed to apply entity resolution fixes" });
      }
    }
  );

  /**
   * POST /api/setup/step/account-sync/complete
   *
   * Marks the account sync review as done and advances to Step 4.
   */
  router.post(
    "/step/account-sync/complete",
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      try {
        await wizardService.completeAccountSyncReview(req.organizationId);
        const status = await wizardService.getStatus(req.organizationId);
        res.json({ completed: true, status });
      } catch (err) {
        console.error("Complete account sync error:", err);
        res.status(500).json({ error: "Failed to complete account sync review" });
      }
    }
  );

  // ── Step 4: Plan Selection ────────────────────────────────────────

  /**
   * GET /api/setup/step/plan
   *
   * Returns available plans with pricing and feature details.
   * When billing is disabled, indicates that the plan step is
   * informational only and will be auto-completed.
   */
  router.get("/step/plan", async (_req: AuthReq, res: Response) => {
    const plans = wizardService.getAvailablePlans();
    res.json({
      plans,
      billing_enabled: isBillingEnabled(),
    });
  });

  /**
   * POST /api/setup/step/plan
   *
   * Selects a plan. For paid plans, returns a Stripe checkout URL.
   * For FREE_TRIAL, activates the 14-day trial immediately.
   *
   * When BILLING_ENABLED is not "true", the step auto-completes as
   * FREE_TRIAL with no trial expiration (internal use mode).
   */
  router.post("/step/plan", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    // When billing is disabled, auto-complete with FREE_TRIAL and no expiration
    if (!isBillingEnabled()) {
      try {
        const result = await wizardService.completePlanSelection(
          req.organizationId,
          "FREE_TRIAL" as Plan,
          {
            createCheckoutSession: async () => null,
          }
        );

        // Remove trial expiration so internal users are never gated
        await prisma.organization.update({
          where: { id: req.organizationId },
          data: { trialEndsAt: null },
        });

        const status = await wizardService.getStatus(req.organizationId);
        res.json({
          completed: true,
          checkoutUrl: result.checkoutUrl,
          billing_enabled: false,
          status,
        });
      } catch (err) {
        console.error("Plan selection error (billing disabled):", err);
        res.status(500).json({ error: "Failed to complete plan selection" });
      }
      return;
    }

    const parse = SelectPlanSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({
        error: "validation_error",
        details: parse.error.issues,
      });
      return;
    }

    try {
      const result = await wizardService.completePlanSelection(
        req.organizationId,
        parse.data.plan as Plan,
        {
          createCheckoutSession: async (orgId: string, plan: Plan) => {
            const org = await prisma.organization.findUnique({
              where: { id: orgId },
            });

            if (!org) return null;

            // Create or retrieve Stripe customer
            let customerId = org.stripeCustomerId;
            if (!customerId) {
              const customer = await stripe.customers.create({
                metadata: {
                  organizationId: orgId,
                  organizationName: org.name,
                },
              });
              customerId = customer.id;
              await prisma.organization.update({
                where: { id: orgId },
                data: { stripeCustomerId: customerId },
              });
            }

            if (plan === "FREE_TRIAL") return null;
            const priceId = getStripePriceId(plan);
            if (!priceId) return null;

            const session = await stripe.checkout.sessions.create({
              customer: customerId,
              mode: "subscription",
              line_items: [{ price: priceId }],
              success_url: buildPublicAppUrl("/admin/setup?checkout=success"),
              cancel_url: buildPublicAppUrl("/admin/setup?checkout=canceled"),
              subscription_data: {
                metadata: { organizationId: orgId, plan },
              },
            });

            return session.url;
          },
        }
      );

      const status = await wizardService.getStatus(req.organizationId);
      res.json({
        completed: true,
        checkoutUrl: result.checkoutUrl,
        status,
      });
    } catch (err) {
      console.error("Plan selection error:", err);
      const message =
        err instanceof Error ? err.message : "Failed to complete plan selection";
      const statusCode = message.includes("not configured") ? 400 : 500;
      res.status(statusCode).json({ error: message });
    }
  });

  // ── Step 5: Permissions ───────────────────────────────────────────

  /**
   * POST /api/setup/step/permissions
   *
   * Sets default landing page permissions for the org, completing the wizard.
   */
  router.post("/step/permissions", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const parse = PermissionsSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({
        error: "validation_error",
        details: parse.error.issues,
      });
      return;
    }

    try {
      await wizardService.completePermissionsSetup(req.organizationId, {
        defaultPageVisibility: parse.data.default_page_visibility,
        allowedPublishers: parse.data.allowed_publishers as UserRole[],
        requireApprovalToPublish: parse.data.require_approval_to_publish,
      });

      const status = await wizardService.getStatus(req.organizationId);
      res.json({ completed: true, status });
    } catch (err) {
      console.error("Permissions setup error:", err);
      res.status(500).json({ error: "Failed to configure permissions" });
    }
  });

  // ── Step 6: Org Profile Context (Setup companion) ────────────────

  router.post("/step/org-profile", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const parse = OrgProfileSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: "validation_error", details: parse.error.issues });
      return;
    }

    try {
      const d = parse.data;
      await prisma.orgSettings.upsert({
        where: { organizationId: req.organizationId },
        create: {
          organizationId: req.organizationId,
          storyContext: {
            companyOverview: d.company_overview ?? "",
            products: d.products ?? [],
            targetPersonas: d.target_personas ?? [],
            targetIndustries: d.target_industries ?? [],
          },
        },
        update: {
          storyContext: {
            companyOverview: d.company_overview ?? "",
            products: d.products ?? [],
            targetPersonas: d.target_personas ?? [],
            targetIndustries: d.target_industries ?? [],
          },
        },
      });
      const status = await wizardService.getStatus(req.organizationId);
      res.json({ updated: true, status });
    } catch (err) {
      console.error("Org profile setup error:", err);
      res.status(500).json({ error: "Failed to save org profile setup" });
    }
  });

  // ── Step 7: Governance Defaults (Setup companion) ────────────────

  router.post("/step/governance-defaults", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const parse = GovernanceDefaultsSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: "validation_error", details: parse.error.issues });
      return;
    }
    try {
      const d = parse.data;
      await prisma.orgSettings.upsert({
        where: { organizationId: req.organizationId },
        create: {
          organizationId: req.organizationId,
          dataGovernancePolicy: {
            retention_days: d.retention_days ?? 365,
            audit_log_retention_days: d.audit_log_retention_days ?? 365,
            legal_hold_enabled: d.legal_hold_enabled ?? false,
            pii_export_enabled: d.pii_export_enabled ?? true,
            deletion_requires_approval: d.deletion_requires_approval ?? true,
            allow_named_story_exports: d.allow_named_story_exports ?? false,
            rto_target_minutes: d.rto_target_minutes ?? 240,
            rpo_target_minutes: d.rpo_target_minutes ?? 60,
          },
        },
        update: {
          dataGovernancePolicy: {
            retention_days: d.retention_days ?? 365,
            audit_log_retention_days: d.audit_log_retention_days ?? 365,
            legal_hold_enabled: d.legal_hold_enabled ?? false,
            pii_export_enabled: d.pii_export_enabled ?? true,
            deletion_requires_approval: d.deletion_requires_approval ?? true,
            allow_named_story_exports: d.allow_named_story_exports ?? false,
            rto_target_minutes: d.rto_target_minutes ?? 240,
            rpo_target_minutes: d.rpo_target_minutes ?? 60,
          },
        },
      });
      const status = await wizardService.getStatus(req.organizationId);
      res.json({ updated: true, status });
    } catch (err) {
      console.error("Governance defaults setup error:", err);
      res.status(500).json({ error: "Failed to save governance defaults" });
    }
  });

  // ── Step 8: Role Presets (Setup companion) ────────────────────────

  router.post("/step/role-presets", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    try {
      await roleProfiles.ensurePresetRoles(req.organizationId);
      const status = await wizardService.getStatus(req.organizationId);
      res.json({ updated: true, status });
    } catch (err) {
      console.error("Role presets setup error:", err);
      res.status(500).json({ error: "Failed to apply role presets" });
    }
  });

  // ── First-Value Workflow Companion ────────────────────────────────

  router.get("/first-value/recommendations", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    try {
      const [storyCount, pageCount, account] = await Promise.all([
        prisma.story.count({ where: { organizationId: req.organizationId } }),
        prisma.landingPage.count({
          where: { organizationId: req.organizationId, status: "PUBLISHED" },
        }),
        prisma.account.findFirst({
          where: { organizationId: req.organizationId },
          select: { id: true, name: true },
          orderBy: { updatedAt: "desc" },
        }),
      ]);

      const tasks: string[] = [];
      if (storyCount === 0) tasks.push("Generate your first story from a high-signal account.");
      if (pageCount === 0) tasks.push("Publish a landing page for sales enablement.");
      if (!account) tasks.push("Sync CRM and map at least one account before generation.");

      res.json({
        starter_story_templates: [
          {
            id: "before_after_transformation",
            label: "Before/After Transformation",
            funnel_stage: "BOFU",
          },
          {
            id: "roi_hard_outcomes",
            label: "ROI and Hard Financial Outcomes",
            funnel_stage: "BOFU",
          },
          {
            id: "implementation_time_to_value",
            label: "Implementation and Time-to-Value",
            funnel_stage: "MOFU",
          },
        ],
        suggested_account: account
          ? { id: account.id, name: account.name }
          : null,
        completion: {
          stories_generated: storyCount,
          pages_published: pageCount,
          first_value_complete: storyCount > 0 && pageCount > 0,
        },
        next_tasks: tasks,
      });
    } catch (err) {
      console.error("First-value recommendation error:", err);
      res.status(500).json({ error: "Failed to load first-value recommendations" });
    }
  });

  // ── Skip Step ─────────────────────────────────────────────────────

  /**
   * POST /api/setup/skip
   *
   * Skips the specified step and advances to the next one.
   * Useful for "I'll do this later" scenarios.
   */
  router.post("/skip", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const parse = SkipStepSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({
        error: "validation_error",
        details: parse.error.issues,
      });
      return;
    }

    try {
      await wizardService.skipStep(
        req.organizationId,
        parse.data.step
      );

      const status = await wizardService.getStatus(req.organizationId);
      res.json({ skipped: true, status });
    } catch (err) {
      console.error("Skip step error:", err);
      res.status(500).json({ error: "Failed to skip step" });
    }
  });

  return router;
}
