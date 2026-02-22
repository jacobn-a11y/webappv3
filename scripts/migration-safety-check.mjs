import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const repoRoot = path.resolve(new URL("../", import.meta.url).pathname);
const migrationsDir = path.join(repoRoot, "prisma", "migrations");
const baselinePath = path.join(repoRoot, "scripts", "migration-safety-baseline.json");
const shouldUpdateBaseline = process.argv.includes("--update-baseline");

const riskyPatterns = [
  /\bDROP\s+TABLE\b/i,
  /\bDROP\s+COLUMN\b/i,
  /\bTRUNCATE\b/i,
  /\bALTER\s+TYPE\b/i,
  /\bDELETE\s+FROM\b/i,
];

function normalizeSqlLine(line) {
  return line.replace(/\s+/g, " ").trim();
}

function createLineHash(line) {
  return crypto.createHash("sha1").update(line).digest("hex").slice(0, 12);
}

function buildFinding(dir, lineNumber, pattern, line) {
  const normalized = normalizeSqlLine(line);
  const hash = createLineHash(normalized);
  const key = `${dir}:L${lineNumber}:${pattern.source}:${hash}`;
  return {
    key,
    migration: dir,
    line: lineNumber,
    pattern: pattern.source,
    hash,
    statement: normalized,
  };
}

function loadBaseline() {
  if (!fs.existsSync(baselinePath)) {
    return { version: 1, generatedAt: null, entries: [] };
  }
  const parsed = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
  return {
    version: Number.isInteger(parsed.version) ? parsed.version : 1,
    generatedAt: parsed.generatedAt ?? null,
    entries,
  };
}

const dirs = fs.readdirSync(migrationsDir)
  .filter((d) => d !== "migration_lock.toml")
  .sort();

const findings = [];
for (const dir of dirs) {
  const file = path.join(migrationsDir, dir, "migration.sql");
  if (!fs.existsSync(file)) continue;
  const sql = fs.readFileSync(file, "utf8");
  const lines = sql.split(/\r?\n/);
  for (let idx = 0; idx < lines.length; idx += 1) {
    const rawLine = lines[idx];
    const normalizedLine = normalizeSqlLine(rawLine);
    if (!normalizedLine) continue;
    for (const pattern of riskyPatterns) {
      if (pattern.test(normalizedLine)) {
        findings.push(buildFinding(dir, idx + 1, pattern, rawLine));
      }
    }
  }
}

findings.sort((a, b) => a.key.localeCompare(b.key));

if (shouldUpdateBaseline) {
  const baseline = {
    version: 1,
    generatedAt: new Date().toISOString(),
    entries: findings,
  };
  fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`Migration safety baseline updated with ${findings.length} entries at ${baselinePath}.`);
  process.exit(0);
}

const baseline = loadBaseline();
const knownKeys = new Set(baseline.entries.map((entry) => entry.key));
const newFindings = findings.filter((finding) => !knownKeys.has(finding.key));

if (newFindings.length > 0) {
  console.error("Migration safety check failed. New risky statements found:");
  for (const finding of newFindings) {
    console.error(
      `- ${finding.migration}:L${finding.line} matched /${finding.pattern}/ [${finding.hash}] :: ${finding.statement}`
    );
  }
  console.error(
    "If intentional, review and run `node scripts/migration-safety-check.mjs --update-baseline` to refresh baseline."
  );
  process.exit(1);
}

console.log(`Migration safety check passed (${findings.length} risky statements matched baseline).`);
