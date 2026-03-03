import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createTestAppWithServer } from "./helpers/create-test-app.js";
import { buildMockStoryResponse } from "./helpers/seed.js";

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx] ?? 0;
}

async function runLoad(
  totalRequests: number,
  concurrency: number,
  fn: () => Promise<void>
): Promise<number[]> {
  const latencies: number[] = [];
  let issued = 0;
  let active = 0;

  await new Promise<void>((resolve, reject) => {
    const pump = () => {
      while (active < concurrency && issued < totalRequests) {
        issued += 1;
        active += 1;
        const started = performance.now();
        fn()
          .then(() => {
            latencies.push(performance.now() - started);
          })
          .catch(reject)
          .finally(() => {
            active -= 1;
            if (issued >= totalRequests && active === 0) {
              resolve();
              return;
            }
            pump();
          });
      }
    };
    pump();
  });

  return latencies;
}

describe("endpoint load budgets", () => {
  it("keeps key endpoint p95/p99 latency under configured budgets", async () => {
    const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
    const budgetPath = path.join(
      repoRoot,
      "scripts",
      "perf",
      "perf-budget.config.json"
    );
    const budget = JSON.parse(fs.readFileSync(budgetPath, "utf8")) as {
      apiLatency: {
        endpointBudgets: Record<
          string,
          {
            path: string;
            method: "GET" | "POST";
            p95Ms: number;
            p99Ms: number;
            requests: number;
            concurrency: number;
          }
        >;
      };
    };

    const ragEngine = {
      query: async () => ({
        answer: "ok",
        sources: [],
        tokensUsed: 10,
      }),
      chat: async () => ({
        answer: "ok",
        sources: [],
        tokensUsed: 10,
      }),
    };
    const storyBuilder = {
      buildStory: async () => ({
        storyId: "story-perf-1",
        ...buildMockStoryResponse(),
      }),
    };
    const prisma = {
      organization: {
        findUnique: async () => ({
          id: "org-test-active",
          plan: "PROFESSIONAL",
          trialEndsAt: new Date(Date.now() + 86_400_000),
        }),
      },
      subscription: {
        findFirst: async () => ({
          id: "sub-1",
          status: "ACTIVE",
          currentPeriodEnd: new Date(Date.now() + 86_400_000),
        }),
      },
      userAccountAccess: { findMany: async () => [] },
      orgSettings: { findUnique: async () => ({ timezone: "UTC" }) },
      story: { create: async () => ({ id: "story-1" }) },
      storyQuote: { createMany: async () => ({ count: 0 }) },
      account: {
        findFirst: async () => ({
          id: "acct-test-001",
          organizationId: "org-test-active",
          name: "Acme",
        }),
      },
    };

    const { request, close } = await createTestAppWithServer({
      prisma,
      ragEngine,
      storyBuilder,
    });

    try {
      const endpointPayload: Record<string, Record<string, unknown>> = {
        rag_query: {
          query: "What changed in the renewal motion?",
          account_id: "acct-test-001",
          organization_id: "org-test-active",
        },
        rag_chat: {
          query: "Any churn risks this month?",
          account_id: "acct-test-001",
          history: [],
        },
        story_build: {
          account_id: "acct-test-001",
          funnel_stages: ["BOFU"],
          filter_topics: ["roi_financial_outcomes"],
          title: "Performance budget story",
        },
      };

      for (const [key, endpoint] of Object.entries(
        budget.apiLatency.endpointBudgets
      )) {
        const latencies = await runLoad(
          endpoint.requests,
          endpoint.concurrency,
          async () => {
            if (endpoint.method === "GET") {
              await request.get(endpoint.path);
              return;
            }
            await request
              .post(endpoint.path)
              .send(endpointPayload[key] ?? {});
          }
        );
        const p95 = percentile(latencies, 95);
        const p99 = percentile(latencies, 99);
        expect(p95).toBeLessThan(endpoint.p95Ms);
        expect(p99).toBeLessThan(endpoint.p99Ms);
      }
    } finally {
      close();
    }
  });
});
