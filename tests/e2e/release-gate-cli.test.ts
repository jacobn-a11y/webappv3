import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";

describe("release gate cli", () => {
  it("fails when launch checklist target is unreachable", () => {
    const repoRoot = path.resolve(__dirname, "..", "..");
    const script = path.join(repoRoot, "scripts", "launch", "run-release-gates.mjs");

    const run = spawnSync("node", [script], {
      cwd: repoRoot,
      env: {
        ...process.env,
        LAUNCH_GATE_DRY_RUN: "true",
        LAUNCH_GATE_FAIL_STEP: "launch_checklist",
      },
      encoding: "utf8",
    });

    const combined = `${run.stdout}\n${run.stderr}`;
    expect(run.status).toBe(1);
    expect(combined).toContain("Release gate failed at step: launch_checklist");
    expect(combined).toContain("[PASS] migration_safety");
    expect(combined).toContain("[FAIL] launch_checklist");
  });

  it("runs post-deploy smoke as a required gate when enabled", () => {
    const repoRoot = path.resolve(__dirname, "..", "..");
    const script = path.join(repoRoot, "scripts", "launch", "run-release-gates.mjs");

    const run = spawnSync("node", [script], {
      cwd: repoRoot,
      env: {
        ...process.env,
        LAUNCH_GATE_DRY_RUN: "true",
        LAUNCH_POST_DEPLOY_SMOKE: "true",
        LAUNCH_GATE_FAIL_STEP: "post_deploy_smoke",
      },
      encoding: "utf8",
    });

    const combined = `${run.stdout}\n${run.stderr}`;
    expect(run.status).toBe(1);
    expect(combined).toContain("Release gate failed at step: post_deploy_smoke");
    expect(combined).toContain("[FAIL] post_deploy_smoke");
  });

  it("runs admin control validation as a required gate when enabled", () => {
    const repoRoot = path.resolve(__dirname, "..", "..");
    const script = path.join(repoRoot, "scripts", "launch", "run-release-gates.mjs");

    const run = spawnSync("node", [script], {
      cwd: repoRoot,
      env: {
        ...process.env,
        LAUNCH_GATE_DRY_RUN: "true",
        LAUNCH_VALIDATE_ADMIN_CONTROLS: "true",
        LAUNCH_GATE_FAIL_STEP: "admin_control_validation",
      },
      encoding: "utf8",
    });

    const combined = `${run.stdout}\n${run.stderr}`;
    expect(run.status).toBe(1);
    expect(combined).toContain("Release gate failed at step: admin_control_validation");
    expect(combined).toContain("[FAIL] admin_control_validation");
  });
});
