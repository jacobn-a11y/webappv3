#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();
const argv = new Set(process.argv.slice(2));
const strict = argv.has("--strict");

const configFlagIndex = process.argv.findIndex((value) => value === "--config");
const configPath =
  configFlagIndex !== -1 && process.argv[configFlagIndex + 1]
    ? process.argv[configFlagIndex + 1]
    : "scripts/contracts/file-size-guard.config.json";

const absoluteConfigPath = path.resolve(cwd, configPath);

if (!fs.existsSync(absoluteConfigPath)) {
  console.error(`File size guard config not found: ${absoluteConfigPath}`);
  process.exit(1);
}

const rawConfig = fs.readFileSync(absoluteConfigPath, "utf8");
const config = JSON.parse(rawConfig);
const files = Array.isArray(config.files) ? config.files : [];

if (files.length === 0) {
  console.log("file-size-guard: no files configured");
  process.exit(0);
}

const violations = [];

for (const entry of files) {
  if (!entry?.path) {
    continue;
  }

  const absoluteFilePath = path.resolve(cwd, entry.path);
  if (!fs.existsSync(absoluteFilePath)) {
    console.warn(`file-size-guard: missing file skipped: ${entry.path}`);
    continue;
  }

  const content = fs.readFileSync(absoluteFilePath, "utf8");
  const lineCount = content.split(/\r?\n/).length;
  const byteCount = Buffer.byteLength(content, "utf8");

  if (typeof entry.maxLines === "number" && lineCount > entry.maxLines) {
    violations.push({
      kind: "lines",
      path: entry.path,
      actual: lineCount,
      limit: entry.maxLines,
    });
  }

  if (typeof entry.maxBytes === "number" && byteCount > entry.maxBytes) {
    violations.push({
      kind: "bytes",
      path: entry.path,
      actual: byteCount,
      limit: entry.maxBytes,
    });
  }
}

if (violations.length === 0) {
  console.log("file-size-guard: all configured files are within limits");
  process.exit(0);
}

for (const violation of violations) {
  console.warn(
    `file-size-guard: ${violation.path} exceeds ${violation.kind} limit (${violation.actual} > ${violation.limit})`
  );
}

if (strict) {
  console.error(`file-size-guard: failing due to ${violations.length} violation(s)`);
  process.exit(1);
}

console.warn(`file-size-guard: warn-only mode with ${violations.length} violation(s)`);
process.exit(0);
