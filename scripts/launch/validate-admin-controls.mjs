import process from "node:process";

const BASE_URL = process.env.LAUNCH_BASE_URL || "http://localhost:3000";
const ADMIN_BEARER = process.env.LAUNCH_ADMIN_BEARER_TOKEN || "";
const ADMIN_SESSION = process.env.LAUNCH_ADMIN_SESSION_TOKEN || "";
const MEMBER_BEARER = process.env.LAUNCH_MEMBER_BEARER_TOKEN || "";
const MEMBER_SESSION = process.env.LAUNCH_MEMBER_SESSION_TOKEN || "";

function hasCreds(role) {
  if (role === "admin") return !!(ADMIN_BEARER || ADMIN_SESSION);
  return !!(MEMBER_BEARER || MEMBER_SESSION);
}

function headers(role) {
  const h = { Accept: "application/json" };
  if (role === "admin") {
    if (ADMIN_BEARER) h.Authorization = `Bearer ${ADMIN_BEARER}`;
    if (ADMIN_SESSION) h["x-session-token"] = ADMIN_SESSION;
    return h;
  }
  if (MEMBER_BEARER) h.Authorization = `Bearer ${MEMBER_BEARER}`;
  if (MEMBER_SESSION) h["x-session-token"] = MEMBER_SESSION;
  return h;
}

const checks = [
  { name: "security_sessions_admin", role: "admin", path: "/api/dashboard/security/sessions", expected: 200 },
  { name: "security_sessions_member", role: "member", path: "/api/dashboard/security/sessions", expected: 403 },
  {
    name: "support_impersonation_sessions_admin",
    role: "admin",
    path: "/api/dashboard/support/impersonation/sessions",
    expected: 200,
  },
  {
    name: "support_impersonation_sessions_member",
    role: "member",
    path: "/api/dashboard/support/impersonation/sessions",
    expected: 403,
  },
  { name: "ops_incidents_admin", role: "admin", path: "/api/dashboard/ops/incidents", expected: 200 },
  { name: "ops_incidents_member", role: "member", path: "/api/dashboard/ops/incidents", expected: 403 },
];

async function runCheck(check) {
  if (!hasCreds(check.role)) {
    return {
      ok: false,
      status: 0,
      error: `${check.role}_credentials_missing`,
    };
  }

  try {
    const res = await fetch(`${BASE_URL}${check.path}`, {
      headers: headers(check.role),
    });
    const ok = res.status === check.expected;
    return {
      ok,
      status: res.status,
      error: ok ? null : `expected_${check.expected}`,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: "network_error",
      detail: err instanceof Error ? err.message : "fetch_failed",
    };
  }
}

const failures = [];
const outputs = [];

for (const check of checks) {
  // eslint-disable-next-line no-await-in-loop
  const result = await runCheck(check);
  outputs.push({ name: check.name, ...result });
  if (!result.ok) failures.push({ name: check.name, ...result });
}

console.log(`Admin controls validation base URL: ${BASE_URL}`);
for (const output of outputs) {
  const status = output.ok ? "PASS" : "FAIL";
  console.log(`- [${status}] ${output.name} :: HTTP ${output.status}${output.error ? ` (${output.error})` : ""}`);
}

if (failures.length > 0) {
  console.error("\nAdmin controls validation failed:");
  for (const failure of failures) {
    console.error(`- ${failure.name}: ${failure.error} (HTTP ${failure.status})`);
  }
  process.exit(1);
}

console.log("\nAdmin controls validation passed.");
