import {
  isDirectExecution,
  normalizeStringField,
  printMode,
  printSummary,
  runStandalone,
} from "./_lib.mjs";

const LIMIT_TYPE_MAP = {
  DAILY_TOKENS: "daily_tokens",
  "daily-tokens": "daily_tokens",
  dailyTokens: "daily_tokens",
  DAILY_REQUESTS: "daily_requests",
  "daily-requests": "daily_requests",
  dailyRequests: "daily_requests",
  MONTHLY_TOKENS: "monthly_tokens",
  "monthly-tokens": "monthly_tokens",
  monthlyTokens: "monthly_tokens",
  MONTHLY_REQUESTS: "monthly_requests",
  "monthly-requests": "monthly_requests",
  monthlyRequests: "monthly_requests",
  MONTHLY_STORIES: "monthly_stories",
  "monthly-stories": "monthly_stories",
  monthlyStories: "monthly_stories",
};

export async function run(prisma, { dryRun = true } = {}) {
  const label = "[normalize-ai-usage-notification-enums]";
  printMode(label, dryRun);

  const summary = await normalizeStringField({
    prisma,
    model: "aiUsageNotification",
    field: "limitType",
    mapping: LIMIT_TYPE_MAP,
    dryRun,
    label: `${label} ai_usage_notification.limit_type`,
  });

  printSummary(label, summary, dryRun);
  return summary;
}

if (isDirectExecution(import.meta.url)) {
  await runStandalone(run);
}
