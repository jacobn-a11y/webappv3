import { resolveDryRun, withPrisma } from "./_lib.mjs";
import { run as runIncident } from "./normalize-incident-enums.mjs";
import { run as runApprovalRequest } from "./normalize-approval-request-enums.mjs";
import { run as runIntegrationRun } from "./normalize-integration-run-enums.mjs";
import { run as runAIUsageNotification } from "./normalize-ai-usage-notification-enums.mjs";

const dryRun = resolveDryRun();
if (!process.env.DATABASE_URL) {
  console.error(
    "[run-enum-normalizations] DATABASE_URL is required. Export it before running this command."
  );
  process.exit(1);
}

const migrations = [
  { name: "incident", run: runIncident },
  { name: "approval-request", run: runApprovalRequest },
  { name: "integration-run", run: runIntegrationRun },
  { name: "ai-usage-notification", run: runAIUsageNotification },
];

await withPrisma(async (prisma) => {
  let matched = 0;
  let changed = 0;

  for (const migration of migrations) {
    const result = await migration.run(prisma, { dryRun });
    matched += result.matched;
    changed += result.changed;
  }

  console.log(
    `[run-enum-normalizations] total_matched=${matched}, ${
      dryRun ? "would_change" : "changed"
    }=${dryRun ? matched : changed}`
  );
});
