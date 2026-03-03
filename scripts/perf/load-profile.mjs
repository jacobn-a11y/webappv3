import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(new URL("../../", import.meta.url).pathname);
const configPath = path.join(repoRoot, "scripts", "perf", "load-profile.config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

const BASE_URL = process.env.PERF_BASE_URL || "http://localhost:3000";
const AUTH_BEARER = process.env.PERF_BEARER_TOKEN || "";
const AUTH_COOKIE = process.env.PERF_AUTH_COOKIE || "";

function makeHeaders() {
  const headers = { "content-type": "application/json" };
  if (AUTH_BEARER) headers.authorization = `Bearer ${AUTH_BEARER}`;
  if (AUTH_COOKIE) headers.cookie = AUTH_COOKIE;
  return headers;
}

async function timedRequest(baseUrl, endpoint) {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}${endpoint.path}`, {
    method: endpoint.method,
    headers: makeHeaders(),
    body:
      endpoint.method === "POST" || endpoint.method === "PATCH"
        ? JSON.stringify(endpoint.body ?? {})
        : undefined,
  });
  await response.text().catch(() => "");
  const elapsedMs = performance.now() - startedAt;
  return { status: response.status, elapsedMs };
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx] ?? 0;
}

function weightedEndpointList(endpoints) {
  const result = [];
  for (const endpoint of endpoints) {
    const weight = Math.max(1, Number(endpoint.weight ?? 1));
    for (let i = 0; i < weight; i += 1) {
      result.push(endpoint);
    }
  }
  return result;
}

function isFailureStatus(status, allowedNon2xxStatuses) {
  if (status >= 200 && status < 300) return false;
  return !allowedNon2xxStatuses.has(status);
}

async function runProfile(profile) {
  const weightedEndpoints = weightedEndpointList(profile.endpoints ?? []);
  if (weightedEndpoints.length === 0) {
    throw new Error(`Profile "${profile.name}" has no endpoints.`);
  }

  console.log(
    `\nRunning ${profile.name} (${profile.requests} requests, concurrency ${profile.concurrency})`
  );

  let issued = 0;
  let inFlight = 0;
  let failures = 0;
  let consecutiveAbortStatuses = 0;
  let aborted = false;
  const latencies = [];

  const abortOnStatuses = new Set(config.failureBehavior.abortOnStatuses ?? []);
  const allowedNon2xxStatuses = new Set(
    config.failureBehavior.allowedNon2xxStatuses ?? []
  );
  const maxConsecutiveAbortStatuses = Math.max(
    1,
    Number(config.failureBehavior.maxConsecutiveAbortStatuses ?? 15)
  );

  await new Promise((resolve) => {
    const pump = async () => {
      while (!aborted && inFlight < profile.concurrency && issued < profile.requests) {
        const endpoint = weightedEndpoints[issued % weightedEndpoints.length];
        issued += 1;
        inFlight += 1;

        timedRequest(BASE_URL, endpoint)
          .then((result) => {
            latencies.push(result.elapsedMs);

            if (abortOnStatuses.has(result.status)) {
              consecutiveAbortStatuses += 1;
            } else {
              consecutiveAbortStatuses = 0;
            }

            if (isFailureStatus(result.status, allowedNon2xxStatuses)) {
              failures += 1;
            }

            if (consecutiveAbortStatuses >= maxConsecutiveAbortStatuses) {
              aborted = true;
            }
          })
          .catch(() => {
            failures += 1;
            consecutiveAbortStatuses += 1;
            if (consecutiveAbortStatuses >= maxConsecutiveAbortStatuses) {
              aborted = true;
            }
          })
          .finally(() => {
            inFlight -= 1;
            if ((issued >= profile.requests || aborted) && inFlight === 0) {
              resolve();
              return;
            }
            void pump();
          });
      }
    };

    void pump();
  });

  const p95 = percentile(latencies, 95);
  const p99 = percentile(latencies, 99);
  const avg =
    latencies.length > 0
      ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length
      : 0;
  const failureRatePct =
    issued > 0 ? Number(((failures / issued) * 100).toFixed(2)) : 0;

  console.log(
    `${profile.name} avg=${avg.toFixed(1)}ms p95=${p95.toFixed(
      1
    )}ms p99=${p99.toFixed(1)}ms failures=${failures}/${issued} (${failureRatePct}%)${
      aborted ? " [ABORTED]" : ""
    }`
  );

  return {
    name: profile.name,
    p95,
    p99,
    avg,
    issued,
    failures,
    failureRatePct,
    aborted,
  };
}

const results = [];
for (const profile of config.profiles ?? []) {
  // eslint-disable-next-line no-await-in-loop
  const result = await runProfile(profile);
  results.push(result);
}

const p95Budget = Number(config.thresholds.p95Ms ?? 750);
const p99Budget = Number(config.thresholds.p99Ms ?? 1500);
const maxFailureRatePct = Number(config.thresholds.maxFailureRatePct ?? 5);

const violations = [];
for (const result of results) {
  if (result.aborted) {
    violations.push(
      `${result.name} aborted due to repeated server-error statuses`
    );
  }
  if (result.p95 > p95Budget) {
    violations.push(`${result.name} p95 ${result.p95.toFixed(1)}ms > ${p95Budget}ms`);
  }
  if (result.p99 > p99Budget) {
    violations.push(`${result.name} p99 ${result.p99.toFixed(1)}ms > ${p99Budget}ms`);
  }
  if (result.failureRatePct > maxFailureRatePct) {
    violations.push(
      `${result.name} failure rate ${result.failureRatePct}% > ${maxFailureRatePct}%`
    );
  }
}

if (violations.length > 0) {
  console.error("Load profile failed:\n" + violations.map((v) => `- ${v}`).join("\n"));
  process.exit(1);
}

console.log("Load profile passed.");
