import { PrismaClient } from "@prisma/client";
import { pathToFileURL } from "node:url";

export function resolveDryRun(argv = process.argv.slice(2)) {
  return !argv.includes("--apply");
}

export function isDirectExecution(importMetaUrl) {
  if (!process.argv[1]) {
    return false;
  }
  return importMetaUrl === pathToFileURL(process.argv[1]).href;
}

export async function withPrisma(run) {
  const prisma = new PrismaClient();
  try {
    return await run(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

export async function runStandalone(run) {
  const dryRun = resolveDryRun();
  return withPrisma((prisma) => run(prisma, { dryRun }));
}

export async function normalizeStringField({
  prisma,
  model,
  field,
  mapping,
  dryRun,
  label,
}) {
  const entries = Object.entries(mapping).filter(([from, to]) => from !== to);
  let matched = 0;
  let changed = 0;

  for (const [from, to] of entries) {
    const where = { [field]: from };
    const count = await prisma[model].count({ where });
    if (count === 0) {
      continue;
    }

    matched += count;
    console.log(
      `${label}: ${from} -> ${to} (${count} row${count === 1 ? "" : "s"})`
    );

    if (!dryRun) {
      const updated = await prisma[model].updateMany({
        where,
        data: { [field]: to },
      });
      changed += updated.count;
    }
  }

  return { matched, changed };
}

export function printMode(label, dryRun) {
  console.log(`${label}: mode=${dryRun ? "dry-run" : "apply"}`);
}

export function printSummary(label, summary, dryRun) {
  const changed = dryRun ? 0 : summary.changed;
  console.log(
    `${label}: matched=${summary.matched}, ${dryRun ? "would_change" : "changed"}=${dryRun ? summary.matched : changed}`
  );
}
