import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(new URL("../../", import.meta.url).pathname);
const budgetPath = path.join(repoRoot, "scripts", "perf", "perf-budget.config.json");
const budget = JSON.parse(fs.readFileSync(budgetPath, "utf8"));

const BASE_URL = process.env.PERF_BASE_URL || "http://localhost:3000";
const AUTH_BEARER = process.env.PERF_BEARER_TOKEN || "";
const AUTH_COOKIE = process.env.PERF_AUTH_COOKIE || "";

function makeHeaders() {
  const headers = { "content-type": "application/json" };
  if (AUTH_BEARER) headers.authorization = `Bearer ${AUTH_BEARER}`;
  if (AUTH_COOKIE) headers.cookie = AUTH_COOKIE;
  return headers;
}

async function timedRequest(url, init) {
  const start = performance.now();
  const resp = await fetch(url, init);
  await resp.text();
  const ms = performance.now() - start;
  return { status: resp.status, ms };
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

const profiles = [
  { name: "tenant-100", requests: 120, concurrency: 8 },
  { name: "tenant-500", requests: 220, concurrency: 16 },
  { name: "tenant-2000", requests: 420, concurrency: 28 }
];

const endpoints = [
  { path: "/api/health", method: "GET" },
  { path: "/api/analytics", method: "GET" },
  { path: "/api/dashboard/home", method: "GET" }
];

async function runProfile(profile) {
  console.log(`\nRunning ${profile.name} (${profile.requests} requests, concurrency ${profile.concurrency})`);
  const latencies = [];
  let failures = 0;

  let inFlight = 0;
  let issued = 0;

  await new Promise((resolve) => {
    const loop = async () => {
      while (inFlight < profile.concurrency && issued < profile.requests) {
        inFlight += 1;
        issued += 1;
        const endpoint = endpoints[issued % endpoints.length];
        timedRequest(`${BASE_URL}${endpoint.path}`, {
          method: endpoint.method,
          headers: makeHeaders()
        })
          .then((result) => {
            latencies.push(result.ms);
            if (result.status >= 500 || result.status === 0) failures += 1;
          })
          .catch(() => {
            failures += 1;
          })
          .finally(() => {
            inFlight -= 1;
            if (issued >= profile.requests && inFlight === 0) {
              resolve();
              return;
            }
            void loop();
          });
      }
    };
    void loop();
  });

  const p95 = percentile(latencies, 95);
  const p99 = percentile(latencies, 99);
  const avg = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;

  console.log(`${profile.name} avg=${avg.toFixed(1)}ms p95=${p95.toFixed(1)}ms p99=${p99.toFixed(1)}ms failures=${failures}`);

  return { ...profile, avg, p95, p99, failures };
}

const results = [];
for (const profile of profiles) {
  // eslint-disable-next-line no-await-in-loop
  results.push(await runProfile(profile));
}

const violations = [];
for (const r of results) {
  if (r.p95 > budget.apiLatency.p95Ms) {
    violations.push(`${r.name} p95 ${r.p95.toFixed(1)}ms > ${budget.apiLatency.p95Ms}ms`);
  }
  if (r.p99 > budget.apiLatency.p99Ms) {
    violations.push(`${r.name} p99 ${r.p99.toFixed(1)}ms > ${budget.apiLatency.p99Ms}ms`);
  }
}

if (violations.length > 0) {
  console.error("Load profile failed:\n" + violations.map((v) => `- ${v}`).join("\n"));
  process.exit(1);
}

console.log("Load profile passed.");
