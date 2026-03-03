import {
  isDirectExecution,
  normalizeStringField,
  printMode,
  printSummary,
  runStandalone,
} from "./_lib.mjs";

const INCIDENT_SEVERITY_MAP = {
  low: "LOW",
  Low: "LOW",
  medium: "MEDIUM",
  Medium: "MEDIUM",
  high: "HIGH",
  High: "HIGH",
  critical: "CRITICAL",
  Critical: "CRITICAL",
};

const INCIDENT_STATUS_MAP = {
  open: "OPEN",
  Open: "OPEN",
  monitoring: "MONITORING",
  Monitoring: "MONITORING",
  resolved: "RESOLVED",
  Resolved: "RESOLVED",
  closed: "RESOLVED",
  Closed: "RESOLVED",
};

export async function run(prisma, { dryRun = true } = {}) {
  const label = "[normalize-incident-enums]";
  printMode(label, dryRun);

  const a = await normalizeStringField({
    prisma,
    model: "incident",
    field: "severity",
    mapping: INCIDENT_SEVERITY_MAP,
    dryRun,
    label: `${label} incident.severity`,
  });

  const b = await normalizeStringField({
    prisma,
    model: "incident",
    field: "status",
    mapping: INCIDENT_STATUS_MAP,
    dryRun,
    label: `${label} incident.status`,
  });

  const c = await normalizeStringField({
    prisma,
    model: "incidentUpdate",
    field: "status",
    mapping: INCIDENT_STATUS_MAP,
    dryRun,
    label: `${label} incident_update.status`,
  });

  const summary = {
    matched: a.matched + b.matched + c.matched,
    changed: a.changed + b.changed + c.changed,
  };
  printSummary(label, summary, dryRun);
  return summary;
}

if (isDirectExecution(import.meta.url)) {
  await runStandalone(run);
}
