import {
  isDirectExecution,
  normalizeStringField,
  printMode,
  printSummary,
  runStandalone,
} from "./_lib.mjs";

const REQUEST_TYPE_MAP = {
  crm_writeback: "CRM_WRITEBACK",
  "crm-writeback": "CRM_WRITEBACK",
  data_deletion: "DATA_DELETION",
  "data-deletion": "DATA_DELETION",
  account_merge: "ACCOUNT_MERGE",
  "account-merge": "ACCOUNT_MERGE",
  landing_page_publish: "LANDING_PAGE_PUBLISH",
  "landing-page-publish": "LANDING_PAGE_PUBLISH",
  data_merge_conflict: "DATA_MERGE_CONFLICT",
  "data-merge-conflict": "DATA_MERGE_CONFLICT",
};

const REQUEST_STATUS_MAP = {
  pending: "PENDING",
  Pending: "PENDING",
  approved: "APPROVED",
  Approved: "APPROVED",
  rejected: "REJECTED",
  Rejected: "REJECTED",
  completed: "COMPLETED",
  Completed: "COMPLETED",
  rolled_back: "ROLLED_BACK",
  "rolled-back": "ROLLED_BACK",
  RolledBack: "ROLLED_BACK",
};

export async function run(prisma, { dryRun = true } = {}) {
  const label = "[normalize-approval-request-enums]";
  printMode(label, dryRun);

  const a = await normalizeStringField({
    prisma,
    model: "approvalRequest",
    field: "requestType",
    mapping: REQUEST_TYPE_MAP,
    dryRun,
    label: `${label} approval_request.request_type`,
  });

  const b = await normalizeStringField({
    prisma,
    model: "approvalRequest",
    field: "status",
    mapping: REQUEST_STATUS_MAP,
    dryRun,
    label: `${label} approval_request.status`,
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
