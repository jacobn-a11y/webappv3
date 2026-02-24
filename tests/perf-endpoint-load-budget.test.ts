import { describe, expect, it } from "vitest";
import { createTestAppWithServer } from "./helpers/create-test-app.js";

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
  it("keeps RAG query/chat p95 latency under budget", async () => {
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
        title: "Test",
        markdown: "Test",
        quotes: [],
      }),
    };
    const prisma = {
      organization: { findUnique: async () => ({ id: "org-test-active", plan: "PROFESSIONAL", trialEndsAt: new Date(Date.now() + 86_400_000) }) },
      subscription: { findFirst: async () => ({ id: "sub-1", status: "ACTIVE", currentPeriodEnd: new Date(Date.now() + 86_400_000) }) },
      userAccountAccess: { findMany: async () => [] },
      orgSettings: { findUnique: async () => ({ timezone: "UTC" }) },
      story: { create: async () => ({ id: "story-1" }) },
      storyQuote: { createMany: async () => ({ count: 0 }) },
      account: { findFirst: async () => ({ id: "acct-test-001", organizationId: "org-test-active", name: "Acme" }) },
    };

    const { request, close } = await createTestAppWithServer({
      prisma,
      ragEngine,
      storyBuilder,
    });

    try {
      const queryLatencies = await runLoad(80, 10, async () => {
        await request.post("/api/rag/query").send({
          query: "What changed in the renewal motion?",
          account_id: "acct-test-001",
          organization_id: "org-test-active",
        });
      });
      const chatLatencies = await runLoad(80, 10, async () => {
        await request.post("/api/rag/chat").send({
          query: "Any churn risks this month?",
          account_id: "acct-test-001",
          history: [],
        });
      });

      const queryP95 = percentile(queryLatencies, 95);
      const chatP95 = percentile(chatLatencies, 95);
      expect(queryP95).toBeLessThan(250);
      expect(chatP95).toBeLessThan(250);
    } finally {
      close();
    }
  });
});
