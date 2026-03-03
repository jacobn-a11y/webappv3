import type { Response } from "express";
import { respondAuthRequired, respondServerError } from "../_shared/errors.js";
import type { AuthReq, SetupRouteContext } from "./types.js";

interface ContextualPrompt {
  id: string;
  title: string;
  detail: string;
  cta_label: string;
  cta_path: string;
  status: "DONE" | "READY" | "BLOCKED";
}

function buildContextualPrompts(input: {
  storyCount: number;
  pageCount: number;
  hasAccount: boolean;
}): ContextualPrompt[] {
  const hasStory = input.storyCount > 0;
  const hasPage = input.pageCount > 0;

  return [
    {
      id: "connect_data",
      title: "Connect data and choose an account",
      detail: input.hasAccount
        ? "You already have synced accounts. Select one high-signal account to start."
        : "Sync at least one account before generating stories.",
      cta_label: input.hasAccount ? "Open Accounts" : "Open Setup",
      cta_path: input.hasAccount ? "/accounts" : "/admin/setup",
      status: input.hasAccount ? "DONE" : "BLOCKED",
    },
    {
      id: "generate_story",
      title: "Generate first story",
      detail: hasStory
        ? "At least one story exists. Keep momentum by generating a stage-specific variant."
        : "Use a high-signal call set and generate your first customer-ready narrative.",
      cta_label: "Generate Story",
      cta_path: "/accounts",
      status: input.hasAccount ? (hasStory ? "DONE" : "READY") : "BLOCKED",
    },
    {
      id: "publish_page",
      title: "Publish and share first page",
      detail: hasPage
        ? "A page is published. Validate packaging and share it with the team."
        : "Publish one landing page so sales can share proof in active deals.",
      cta_label: hasPage ? "View Pages" : "Publish Page",
      cta_path: "/dashboard/pages",
      status: hasPage ? "DONE" : hasStory ? "READY" : "BLOCKED",
    },
  ];
}

export function registerSetupFirstValueRoutes({
  prisma,
  router,
}: Pick<SetupRouteContext, "prisma" | "router">): void {
  router.get("/first-value/recommendations", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      respondAuthRequired(res);
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
      if (storyCount === 0) {
        tasks.push("Generate your first story from a high-signal account.");
      }
      if (pageCount === 0) {
        tasks.push("Publish a landing page for sales enablement.");
      }
      if (!account) {
        tasks.push("Sync CRM and map at least one account before generation.");
      }

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
        suggested_account: account ? { id: account.id, name: account.name } : null,
        completion: {
          stories_generated: storyCount,
          pages_published: pageCount,
          first_value_complete: storyCount > 0 && pageCount > 0,
        },
        contextual_prompts: buildContextualPrompts({
          storyCount,
          pageCount,
          hasAccount: !!account,
        }),
        next_tasks: tasks,
      });
    } catch (err) {
      respondServerError(
        res,
        "First-value recommendation error:",
        "Failed to load first-value recommendations",
        err
      );
    }
  });
}
