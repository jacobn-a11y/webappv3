import type { Response } from "express";
import { requirePermission } from "../../middleware/permissions.js";
import { sendUnauthorized } from "../_shared/responses.js";
import { parseRequestBody } from "../_shared/validators.js";
import { AddBalanceSchema } from "./schemas.js";
import type { AISettingsRouteContext, AuthReq } from "./types.js";
import logger from "../../lib/logger.js";
import { asyncHandler } from "../../lib/async-handler.js";

export function registerAISettingsBillingRoutes({
  prisma,
  router,
  usageTracker,
}: Pick<AISettingsRouteContext, "prisma" | "router" | "usageTracker">): void {
  router.get(
    "/admin/balances",
    requirePermission(prisma, "manage_ai_settings"),
    asyncHandler(async (req: AuthReq, res: Response) => {
      if (!req.organizationId!) {
        sendUnauthorized(res);
        return;
      }

        const balances = await prisma.userAIBalance.findMany({
          where: { organizationId: req.organizationId! },
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
      
    }
  ));

  router.post(
    "/admin/balances/top-up",
    requirePermission(prisma, "manage_ai_settings"),
    asyncHandler(async (req: AuthReq, res: Response) => {
      const payload = parseRequestBody(AddBalanceSchema, req.body, res);
      if (!payload) {
        return;
      }

      if (!req.organizationId!) {
        sendUnauthorized(res);
        return;
      }

        await usageTracker.addBalance(
          req.organizationId!,
          payload.user_id,
          payload.amount_cents,
          payload.description
        );

        res.json({ topped_up: true, amount_cents: payload.amount_cents });
      
    }
  ));

  router.get(
    "/admin/balances/:userId",
    requirePermission(prisma, "manage_ai_settings"),
    asyncHandler(async (req: AuthReq, res: Response) => {
      if (!req.organizationId!) {
        sendUnauthorized(res);
        return;
      }

        const balance = await usageTracker.getBalance(
          req.organizationId!,
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
      
    }
  ));
}
