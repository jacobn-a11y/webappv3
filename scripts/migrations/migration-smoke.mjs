import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..");
const args = new Set(process.argv.slice(2));

if (args.has("--help")) {
  console.log(`Usage: node scripts/migrations/migration-smoke.mjs

Runs migration smoke checks against isolated Postgres schemas:
- clean DB path
- seeded DB path
- upgrade path from an older migration state

Environment:
- TEST_DATABASE_URL or DATABASE_URL (required; Postgres URL)
- MIGRATION_SMOKE_BASE (optional; migration folder used as upgrade baseline)
`);
  process.exit(0);
}

const baseDatabaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
if (!baseDatabaseUrl) {
  console.error("[migration-smoke] TEST_DATABASE_URL or DATABASE_URL is required.");
  process.exit(1);
}

let parsedDatabaseUrl;
try {
  parsedDatabaseUrl = new URL(baseDatabaseUrl);
} catch (error) {
  console.error("[migration-smoke] Invalid database URL.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

if (!["postgresql:", "postgres:"].includes(parsedDatabaseUrl.protocol)) {
  console.error("[migration-smoke] Postgres URL required.");
  process.exit(1);
}

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";

const migrationsRoot = path.join(repoRoot, "prisma", "migrations");
const migrationDirs = fs.readdirSync(migrationsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

if (migrationDirs.length === 0) {
  console.error("[migration-smoke] No Prisma migrations found.");
  process.exit(1);
}

const latestMigration = migrationDirs[migrationDirs.length - 1];
const requestedBaseMigration = process.env.MIGRATION_SMOKE_BASE ?? "";
let baseMigration = migrationDirs[Math.max(0, migrationDirs.length - 2)];

if (requestedBaseMigration) {
  if (!migrationDirs.includes(requestedBaseMigration)) {
    console.error(
      `[migration-smoke] MIGRATION_SMOKE_BASE=${requestedBaseMigration} does not match an existing migration.`
    );
    process.exit(1);
  }
  if (requestedBaseMigration === latestMigration && migrationDirs.length > 1) {
    console.error(
      `[migration-smoke] MIGRATION_SMOKE_BASE must be older than latest (${latestMigration}).`
    );
    process.exit(1);
  }
  baseMigration = requestedBaseMigration;
}

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const cleanSchema = `mig_smoke_clean_${runId}`;
const seededSchema = `mig_smoke_seeded_${runId}`;
const upgradeSchema = `mig_smoke_upgrade_${runId}`;

function buildSchemaUrl(schemaName) {
  const url = new URL(baseDatabaseUrl);
  url.searchParams.set("schema", schemaName);
  return url.toString();
}

const cleanUrl = buildSchemaUrl(cleanSchema);
const seededUrl = buildSchemaUrl(seededSchema);
const upgradeUrl = buildSchemaUrl(upgradeSchema);

function withDatabase(url) {
  return {
    DATABASE_URL: url,
    TEST_DATABASE_URL: url,
    PRISMA_HIDE_UPDATE_MESSAGE: "1",
  };
}

function runStep(label, command, commandArgs, env = {}) {
  console.log(`\n[migration-smoke] ${label}`);
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) {
    throw new Error(`[migration-smoke] Step failed: ${label}`);
  }
}

function copyMigrationSubset(targetPrismaDir, migrationNames) {
  const targetMigrationsDir = path.join(targetPrismaDir, "migrations");
  fs.mkdirSync(targetMigrationsDir, { recursive: true });

  fs.copyFileSync(
    path.join(repoRoot, "prisma", "schema.prisma"),
    path.join(targetPrismaDir, "schema.prisma")
  );

  const migrationLock = path.join(migrationsRoot, "migration_lock.toml");
  if (fs.existsSync(migrationLock)) {
    fs.copyFileSync(migrationLock, path.join(targetMigrationsDir, "migration_lock.toml"));
  }

  for (const migrationName of migrationNames) {
    fs.cpSync(
      path.join(migrationsRoot, migrationName),
      path.join(targetMigrationsDir, migrationName),
      { recursive: true }
    );
  }
}

const baseIndex = migrationDirs.indexOf(baseMigration);
const baselineMigrationSet = migrationDirs.slice(0, baseIndex + 1);
const canRunUpgradePath = baselineMigrationSet.length > 0 && baseMigration !== latestMigration;

console.log("[migration-smoke] Configuration");
console.log(`- migrations: ${migrationDirs.length}`);
console.log(`- latest: ${latestMigration}`);
console.log(`- upgrade baseline: ${baseMigration}`);

let upgradeFixtureRoot = "";

try {
  runStep(
    "clean path: prisma migrate deploy",
    npxCmd,
    ["prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"],
    withDatabase(cleanUrl)
  );
  runStep(
    "clean path: prisma migrate status",
    npxCmd,
    ["prisma", "migrate", "status", "--schema", "prisma/schema.prisma"],
    withDatabase(cleanUrl)
  );

  runStep(
    "seeded path: prisma migrate deploy",
    npxCmd,
    ["prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"],
    withDatabase(seededUrl)
  );
  runStep("seeded path: db seed", npmCmd, ["run", "-s", "db:seed"], withDatabase(seededUrl));
  runStep(
    "seeded path: enum normalization dry-run",
    npmCmd,
    ["run", "-s", "db:normalize:enums:dry"],
    withDatabase(seededUrl)
  );
  runStep(
    "seeded path: prisma migrate deploy (post-seed)",
    npxCmd,
    ["prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"],
    withDatabase(seededUrl)
  );

  if (canRunUpgradePath) {
    upgradeFixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "migration-smoke-"));
    const fixturePrismaDir = path.join(upgradeFixtureRoot, "prisma");
    copyMigrationSubset(fixturePrismaDir, baselineMigrationSet);

    runStep(
      `upgrade path: deploy baseline (${baseMigration})`,
      npxCmd,
      ["prisma", "migrate", "deploy", "--schema", path.join(fixturePrismaDir, "schema.prisma")],
      withDatabase(upgradeUrl)
    );
    runStep(
      "upgrade path: deploy latest",
      npxCmd,
      ["prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"],
      withDatabase(upgradeUrl)
    );
    runStep(
      "upgrade path: prisma migrate status",
      npxCmd,
      ["prisma", "migrate", "status", "--schema", "prisma/schema.prisma"],
      withDatabase(upgradeUrl)
    );
  } else {
    console.log("[migration-smoke] Upgrade path skipped (single migration or base == latest).");
  }

  console.log("\n[migration-smoke] All migration smoke paths passed.");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
} finally {
  if (upgradeFixtureRoot) {
    fs.rmSync(upgradeFixtureRoot, { recursive: true, force: true });
  }
}
