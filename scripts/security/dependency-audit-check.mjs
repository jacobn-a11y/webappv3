#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const allowlistPath = path.join(
  repoRoot,
  "docs",
  "security",
  "dependency-audit-allowlist.json"
);

const severityRank = {
  info: 0,
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
};

function runAudit(scope, command, args) {
  const proc = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const output = (proc.stdout || "").trim() || (proc.stderr || "").trim();
  if (!output) {
    throw new Error(`No audit JSON received for scope "${scope}"`);
  }
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch (err) {
    throw new Error(
      `Failed to parse npm audit JSON for scope "${scope}": ${String(err)}\n${output}`
    );
  }
  return parsed;
}

function loadAllowlist() {
  if (!fs.existsSync(allowlistPath)) {
    return {};
  }
  const raw = fs.readFileSync(allowlistPath, "utf8");
  return JSON.parse(raw);
}

function isAllowlisted(allowlist, scope, packageName) {
  const scoped = allowlist[scope] ?? {};
  const entry = scoped[packageName];
  if (!entry) return { allowlisted: false };
  if (entry.expires_at) {
    const expiry = new Date(entry.expires_at);
    if (Number.isNaN(expiry.getTime()) || expiry.getTime() < Date.now()) {
      return { allowlisted: false, expired: true, entry };
    }
  }
  return { allowlisted: true, entry };
}

function collectFindings(scope, report, allowlist) {
  const vulnerabilities = report?.vulnerabilities ?? {};
  const unresolved = [];
  const triaged = [];
  for (const [name, details] of Object.entries(vulnerabilities)) {
    const severity = typeof details?.severity === "string" ? details.severity : "info";
    if ((severityRank[severity] ?? 0) < severityRank.high) {
      continue;
    }
    const status = isAllowlisted(allowlist, scope, name);
    if (status.allowlisted) {
      triaged.push({
        scope,
        name,
        severity,
        reason: status.entry?.reason ?? "triaged",
        expires_at: status.entry?.expires_at ?? null,
      });
      continue;
    }
    unresolved.push({
      scope,
      name,
      severity,
      expired: status.expired ?? false,
      fixAvailable: details?.fixAvailable ?? null,
    });
  }
  return { unresolved, triaged };
}

function main() {
  const allowlist = loadAllowlist();
  const rootReport = runAudit("root", "npm", ["audit", "--omit=dev", "--json"]);
  const frontendReport = runAudit("frontend", "npm", [
    "--prefix",
    "frontend",
    "audit",
    "--omit=dev",
    "--json",
  ]);

  const rootFindings = collectFindings("root", rootReport, allowlist);
  const frontendFindings = collectFindings("frontend", frontendReport, allowlist);
  const unresolved = [...rootFindings.unresolved, ...frontendFindings.unresolved];
  const triaged = [...rootFindings.triaged, ...frontendFindings.triaged];

  if (triaged.length > 0) {
    console.log("Dependency audit: triaged high/critical vulnerabilities:");
    for (const item of triaged) {
      console.log(
        `- ${item.scope}:${item.name} (${item.severity}) — ${item.reason} (expires ${item.expires_at ?? "n/a"})`
      );
    }
  }

  if (unresolved.length > 0) {
    console.error("Dependency audit failed: unresolved high/critical vulnerabilities found.");
    for (const item of unresolved) {
      console.error(
        `- ${item.scope}:${item.name} (${item.severity})` +
          (item.expired ? " [allowlist expired]" : "")
      );
    }
    process.exit(1);
  }

  console.log("Dependency audit passed: no unresolved high/critical vulnerabilities.");
}

main();
