import type { Response } from "express";
import { requirePermission } from "../../middleware/permissions.js";
import { respondAuthRequired } from "../_shared/errors.js";
import { parseRequestBody } from "../_shared/validators.js";
import { AddBalanceSchema } from "./schemas.js";
import type { AISettingsRouteContext, AuthReq } from "./types.js";

export function registerAISettingsBillingRoutes({
  prisma,
  router,
  usageTracker,
}: Pick<AISettingsRouteContext, "prisma" | "router" | "usageTracker">): void {
  router.get(
    "/admin/balances",
    requirePermission(prisma, "manage_ai_settings"),
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        respondAuthRequired(res);
        return;
      }

      try {
        const balances = await prisma.userAIBalance.findMany({
          where: { organizationId: req.organizationId },
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
          orderBy: { updatedAt: "desc" },
        });

        res.json({
          balances: balances.map((balance) => ({
            user_id: balance.userId,
            user_name: balance.user.name,
            user_email: balance.user.email,
            balance_cents: balance.balanceCents,
            lifetime_spent_cents: balance.lifetimeSpentCents,
            updated_at: balance.updatedAt.toISOString(),
          })),
        });
      } catch (err) {
        console.error("List balances error:", err);
        res.status(500).json({ error: "Failed to list balances" });
      }
    }
  );

  router.post(
    "/admin/balances/top-up",
    requirePermission(prisma, "manage_ai_settings"),
    async (req: AuthReq, res: Response) => {
      const payload = parseRequestBody(AddBalanceSchema, req.body, res);
      if (!payload) {
        return;
      }

      if (!req.organizationId) {
        respondAuthRequired(res);
        return;
      }

      try {
        await usageTracker.addBalance(
          req.organizationId,
          payload.user_id,
          payload.amount_cents,
          payload.description
        );

        res.json({ topped_up: true, amount_cents: payload.amount_cents });
      } catch (err) {
        console.error("Top-up balance error:", err);
        res.status(500).json({ error: "Failed to top up balance" });
      }
    }
  );

  router.get(
    "/admin/balances/:userId",
    requirePermission(prisma, "manage_ai_settings"),
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        respondAuthRequired(res);
        return;
      }

      try {
        const balance = await usageTracker.getBalance(
          req.organizationId,
          req.params.userId as string
        );

        if (!balance) {
          res.json({ balance: null });
          return;
        }

        res.json({
          balance: {
            balance_cents: balance.balanceCents,
            lifetime_spent_cents: balance.lifetimeSpentCents,
            transactions: balance.transactions.map((txn) => ({
              id: txn.id,
              type: txn.type,
              amount_cents: txn.amountCents,
              description: txn.description,
              created_at: txn.createdAt.toISOString(),
            })),
          },
        });
      } catch (err) {
        console.error("Get user balance error:", err);
        res.status(500).json({ error: "Failed to get user balance" });
      }
    }
  );
}
