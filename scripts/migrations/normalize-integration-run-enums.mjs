import {
  isDirectExecution,
  normalizeStringField,
  printMode,
  printSummary,
  runStandalone,
} from "./_lib.mjs";

const RUN_TYPE_MAP = {
  manual: "MANUAL",
  Manual: "MANUAL",
  scheduled: "SCHEDULED",
  Scheduled: "SCHEDULED",
  backfill: "BACKFILL",
  Backfill: "BACKFILL",
  "back-fill": "BACKFILL",
};

const RUN_STATUS_MAP = {
  pending: "PENDING",
  Pending: "PENDING",
  running: "RUNNING",
  Running: "RUNNING",
  completed: "COMPLETED",
  Completed: "COMPLETED",
  success: "COMPLETED",
  succeeded: "COMPLETED",
  failed: "FAILED",
  Failed: "FAILED",
  error: "ERROR",
  Error: "ERROR",
};

export async function run(prisma, { dryRun = true } = {}) {
  const label = "[normalize-integration-run-enums]";
  printMode(label, dryRun);

  const a = await normalizeStringField({
    prisma,
    model: "integrationRun",
    field: "runType",
    mapping: RUN_TYPE_MAP,
    dryRun,
    label: `${label} integration_run.run_type`,
  });

  const b = await normalizeStringField({
    prisma,
    model: "integrationRun",
    field: "status",
    mapping: RUN_STATUS_MAP,
    dryRun,
    label: `${label} integration_run.status`,
  });

  const summary = {
    matched: a.matched + b.matched,
    changed: a.changed + b.changed,
  };
  printSummary(label, summary, dryRun);
  return summary;
}

if (isDirectExecution(import.meta.url)) {
  await runStandalone(run);
}
