const baseUrl = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const bearer = process.env.SMOKE_BEARER_TOKEN || "";
const cookie = process.env.SMOKE_AUTH_COOKIE || "";
const sessionToken = process.env.SMOKE_SESSION_TOKEN || "";
const supportImpersonationToken = process.env.SMOKE_SUPPORT_IMPERSONATION_TOKEN || "";
const smokeOrgId = process.env.SMOKE_ORGANIZATION_ID || "";
const hasAuth = !!(bearer || cookie);

function headers() {
  const h = { "content-type": "application/json" };
  if (bearer) h.authorization = `Bearer ${bearer}`;
  if (cookie) h.cookie = cookie;
  if (sessionToken) h["x-session-token"] = sessionToken;
  if (supportImpersonationToken) {
    h["x-support-impersonation-token"] = supportImpersonationToken;
  }
  return h;
}

async function check(path, opts = {}) {
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "GET",
      headers: headers(),
      ...opts,
    });
    return { path, status: res.status, body: await res.text() };
  } catch (err) {
    return {
      path,
      status: 0,
      body: err instanceof Error ? err.message : "network_error",
    };
  }
}

const checks = [
  { path: "/api/health", required: true },
  { path: "/api/analytics", required: false },
  { path: "/api/dashboard/home", required: false },
  { path: "/api/dashboard/feature-flags/resolved", required: false },
  { path: "/api/dashboard/customer-success/health", required: false },
  { path: "/api/dashboard/customer-success/renewal-value-report", required: false },
  { path: "/api/dashboard/ops/diagnostics", required: false },
  { path: "/api/dashboard/security/sessions", required: false, authOnly: true },
  { path: "/api/dashboard/support/impersonation/sessions", required: false, authOnly: true },
  ...(smokeOrgId
    ? [{ path: `/api/status/incidents?organization_id=${encodeURIComponent(smokeOrgId)}`, required: false }]
    : []),
];

const failures = [];
for (const checkDef of checks) {
  if (checkDef.authOnly && !hasAuth) {
    console.log(`${checkDef.path} -> SKIPPED (auth not configured)`);
    continue;
  }
  // eslint-disable-next-line no-await-in-loop
  const result = await check(checkDef.path);
  const ok = checkDef.required
    ? result.status === 200
    : [200, 401, 403].includes(result.status);
  if (!ok) {
    failures.push(`${result.path} -> ${result.status}`);
  }
  console.log(`${result.path} -> ${result.status}`);
}

if (failures.length) {
  console.error("Smoke checks failed:\n" + failures.map((f) => `- ${f}`).join("\n"));
  process.exit(1);
}

console.log("Smoke checks passed.");
