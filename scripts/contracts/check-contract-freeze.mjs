import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const repoRoot = path.resolve(new URL("../../", import.meta.url).pathname);
const manifestPath = path.join(repoRoot, "scripts", "contracts", "contract-freeze.json");
const update = process.argv.includes("--update");

const contractFiles = [
  "prisma/schema.prisma",
  "src/api/dashboard-routes.ts",
  "src/api/landing-page-routes.ts",
  "src/api/integration-routes.ts",
  "src/api/scim-routes.ts",
  "src/middleware/permissions.ts",
  "src/services/policy-engine.ts",
];

function sha256File(filePath) {
  const absolute = path.join(repoRoot, filePath);
  if (!fs.existsSync(absolute)) {
    return null;
  }
  const content = fs.readFileSync(absolute);
  return crypto.createHash("sha256").update(content).digest("hex");
}

function buildCurrent() {
  const files = contractFiles.map((file) => ({ file, sha256: sha256File(file) }));
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    files,
  };
}

const current = buildCurrent();
if (update || !fs.existsSync(manifestPath)) {
  fs.writeFileSync(manifestPath, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`Contract freeze manifest updated at ${manifestPath}`);
  process.exit(0);
}

const baseline = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const baselineMap = new Map((baseline.files ?? []).map((entry) => [entry.file, entry.sha256]));

const drift = [];
for (const entry of current.files) {
  const expected = baselineMap.get(entry.file);
  if (!expected) {
    drift.push({ file: entry.file, reason: "missing_in_baseline" });
    continue;
  }
  if (expected !== entry.sha256) {
    drift.push({ file: entry.file, reason: "hash_changed" });
  }
}

for (const [file] of baselineMap.entries()) {
  if (!current.files.find((entry) => entry.file === file)) {
    drift.push({ file, reason: "missing_in_current" });
  }
}

if (drift.length > 0) {
  console.error("Contract freeze check failed. Drift detected:");
  for (const d of drift) {
    console.error(`- ${d.file}: ${d.reason}`);
  }
  console.error("If intended, run: npm run contracts:update");
  process.exit(1);
}

console.log("Contract freeze check passed.");
