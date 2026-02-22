import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(new URL("../../", import.meta.url).pathname);
const outDir = path.join(repoRoot, "docs", "release-evidence");
fs.mkdirSync(outDir, { recursive: true });

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
    shell: process.platform === "win32",
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

const ts = new Date().toISOString().replace(/[:]/g, "-");
const filename = `release-evidence-${ts}.md`;
const filepath = path.join(outDir, filename);

const gitSha = run("git", ["rev-parse", "HEAD"]);
const gitBranch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
const gate = run("npm", ["run", "launch:gate"]);
const contracts = run("npm", ["run", "contracts:check"]);
const migrateSafety = run("npm", ["run", "migrate:safety"]);

const lines = [];
lines.push("# Release Evidence");
lines.push("");
lines.push(`- Generated At: ${new Date().toISOString()}`);
lines.push(`- Commit SHA: ${(gitSha.stdout || "unknown").trim()}`);
lines.push(`- Branch: ${(gitBranch.stdout || "unknown").trim()}`);
lines.push(`- CI Run URL: ${process.env.CI_RUN_URL || "(not provided)"}`);
lines.push("");

function appendSection(title, output) {
  lines.push(`## ${title}`);
  lines.push(`- Exit Code: ${output.status}`);
  lines.push("```text");
  const text = `${output.stdout}${output.stderr}`.trim();
  lines.push(text || "(no output)");
  lines.push("```");
  lines.push("");
}

appendSection("Launch Gate", gate);
appendSection("Contracts Check", contracts);
appendSection("Migration Safety", migrateSafety);

const pass = gate.status === 0 && contracts.status === 0 && migrateSafety.status === 0;
lines.push("## Overall");
lines.push(pass ? "PASS" : "FAIL");
lines.push("");

fs.writeFileSync(filepath, `${lines.join("\n")}\n`);
console.log(`Release evidence written: ${filepath}`);

if (!pass) {
  process.exit(1);
}
