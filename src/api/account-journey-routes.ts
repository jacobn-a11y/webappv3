/**
 * Account Journey Timeline Routes
 *
 * Provides:
 *   - GET /api/accounts/:accountId/journey — JSON API for timeline data
 */

import { Router, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { AccountJourneyService } from "../services/account-journey.js";
import type { AuthenticatedRequest } from "../types/authenticated-request.js";
import { asyncHandler } from "../lib/async-handler.js";
import { sendUnauthorized, sendSuccess } from "./_shared/responses.js";

export function createAccountJourneyRoutes(prisma: PrismaClient): Router {
  const router = Router();
  const journeyService = new AccountJourneyService(prisma);

  router.get(
    "/:accountId/journey",
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      if (!req.organizationId) {
        sendUnauthorized(res, "Authentication required");
        return;
      }

      const data = await journeyService.getAccountJourney(
        req.params.accountId as string,
        req.organizationId
      );

      res.setHeader("Cache-Control", "private, no-store");
      sendSuccess(res, {
        account: {
          id: data.account.id,
          name: data.account.name,
          domain: data.account.domain,
          industry: data.account.industry,
          employee_count: data.account.employeeCount,
          annual_revenue: data.account.annualRevenue,
          salesforce_id: data.account.salesforceId,
          hubspot_id: data.account.hubspotId,
          contact_count: data.account.contactCount,
          call_count: data.account.callCount,
          total_call_minutes: data.account.totalCallMinutes,
          story_count: data.account.storyCount,
          top_contacts: data.account.topContacts.map((c) => ({
            id: c.id,
            name: c.name,
            email: c.email,
            title: c.title,
            call_appearances: c.callAppearances,
          })),
        },
        timeline: data.timeline.map((node) => {
          if (node.type === "call") {
            return {
              type: "call",
              id: node.id,
              date: node.date,
              title: node.title,
              provider: node.provider,
              duration: node.duration,
              primary_stage: node.primaryStage,
              participants: node.participants.map((p) => ({
                id: p.id,
                name: p.name,
                email: p.email,
                is_host: p.isHost,
                title: p.title,
              })),
              tags: node.tags.map((t) => ({
                funnel_stage: t.funnelStage,
                topic: t.topic,
                topic_label: t.topicLabel,
                confidence: t.confidence,
              })),
            };
          }

          return {
            type: "crm_event",
            id: node.id,
            date: node.date,
            event_type: node.eventType,
            stage_name: node.stageName,
            opportunity_id: node.opportunityId,
            amount: node.amount,
            description: node.description,
          };
        }),
        stage_counts: data.stageCounts,
      });
    })
  );

  return router;
}
