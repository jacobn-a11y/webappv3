import process from "node:process";

const BASE_URL = process.env.LAUNCH_BASE_URL || "http://localhost:3000";
const AUTH_BEARER = process.env.LAUNCH_BEARER_TOKEN || "";
const SESSION_TOKEN = process.env.LAUNCH_SESSION_TOKEN || "";
const SUPPORT_IMPERSONATION_TOKEN = process.env.LAUNCH_SUPPORT_IMPERSONATION_TOKEN || "";
const LAUNCH_ORGANIZATION_ID = process.env.LAUNCH_ORGANIZATION_ID || "";
const hasAuth = !!(AUTH_BEARER || SESSION_TOKEN);

function headers() {
  const h = { Accept: "application/json" };
  if (AUTH_BEARER) h.Authorization = `Bearer ${AUTH_BEARER}`;
  if (SESSION_TOKEN) h["x-session-token"] = SESSION_TOKEN;
  if (SUPPORT_IMPERSONATION_TOKEN) {
    h["x-support-impersonation-token"] = SUPPORT_IMPERSONATION_TOKEN;
  }
  return h;
}

const checks = [
  {
    name: "health",
    path: "/api/health",
    required: true,
    validate: (body) => body?.status === "ok",
  },
  {
    name: "dashboard_home",
    path: "/api/dashboard/home",
    required: false,
    validate: (body) => !!body?.summary,
  },
  {
    name: "ops_diagnostics",
    path: "/api/dashboard/ops/diagnostics",
    required: false,
    validate: (body) => !!body?.tenant,
  },
  {
    name: "cs_health",
    path: "/api/dashboard/customer-success/health",
    required: false,
    validate: (body) => typeof body?.overall_score === "number",
  },
  {
    name: "renewal_value_report",
    path: "/api/dashboard/customer-success/renewal-value-report",
    required: false,
    validate: (body) => typeof body?.renewal_health === "string",
  },
  {
    name: "support_impersonation_sessions",
    path: "/api/dashboard/support/impersonation/sessions",
    required: false,
    authOnly: true,
    validate: (body) => Array.isArray(body?.sessions),
  },
  {
    name: "security_sessions",
    path: "/api/dashboard/security/sessions",
    required: false,
    authOnly: true,
    validate: (body) => Array.isArray(body?.sessions),
  },
  {
    name: "incident_feed_internal",
    path: "/api/dashboard/ops/incidents",
    required: false,
    authOnly: true,
    validate: (body) => Array.isArray(body?.incidents),
  },
  ...(LAUNCH_ORGANIZATION_ID
    ? [{
        name: "public_status_incidents",
        path: `/api/status/incidents?organization_id=${encodeURIComponent(LAUNCH_ORGANIZATION_ID)}`,
        required: false,
        validate: (body) => Array.isArray(body?.incidents),
      }]
    : []),
];

async function runCheck(check) {
  if (check.authOnly && !hasAuth) {
    return {
      ok: true,
      status: 0,
      skipped: true,
      reason: "auth_not_configured",
    };
  }

  let res;
  let text = "";
  let body = null;
  try {
    res = await fetch(`${BASE_URL}${check.path}`, { headers: headers() });
    text = await res.text();
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text };
    }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: "network_error",
      body: { message: err instanceof Error ? err.message : "fetch_failed" },
    };
  }

  if (res.status >= 500) {
    return { ok: false, status: res.status, error: "server_error", body };
  }

  if (check.required && res.status !== 200) {
    return { ok: false, status: res.status, error: "required_check_failed", body };
  }

  if (res.status === 200 && check.validate && !check.validate(body)) {
    return { ok: false, status: res.status, error: "validation_failed", body };
  }

  const optionalAuthMissing = !check.required && (res.status === 401 || res.status === 403);
  if (optionalAuthMissing) {
    return { ok: true, status: res.status, skipped: true, reason: "auth_required" };
  }

  return { ok: true, status: res.status, body };
}

const failures = [];
const outputs = [];

for (const check of checks) {
  // eslint-disable-next-line no-await-in-loop
  const result = await runCheck(check);
  outputs.push({ name: check.name, ...result });
  if (!result.ok) failures.push({ name: check.name, ...result });
}

console.log(`Launch checklist base URL: ${BASE_URL}`);
for (const output of outputs) {
  const status = output.ok ? "PASS" : "FAIL";
  const suffix = output.skipped ? ` (skipped: ${output.reason})` : "";
  console.log(`- [${status}] ${output.name} :: HTTP ${output.status}${suffix}`);
}

if (failures.length > 0) {
  console.error("\nLaunch checklist failed:");
  for (const failure of failures) {
    console.error(`- ${failure.name}: ${failure.error} (HTTP ${failure.status})`);
  }
  process.exit(1);
}

console.log("\nLaunch checklist passed.");
