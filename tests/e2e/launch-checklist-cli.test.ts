import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";

describe("launch checklist cli", () => {
  it("fails cleanly with network_error when target is unreachable", () => {
    const repoRoot = path.resolve(__dirname, "..", "..");
    const script = path.join(repoRoot, "scripts", "launch", "run-launch-checklist.mjs");

    const run = spawnSync("node", [script], {
      cwd: repoRoot,
      env: {
        ...process.env,
        LAUNCH_BASE_URL: "http://127.0.0.1:65534",
      },
      encoding: "utf8",
    });

    expect(run.status).toBe(1);
    const combined = `${run.stdout}\n${run.stderr}`;
    expect(combined).toContain("Launch checklist failed");
    expect(combined).toContain("network_error");
    expect(run.stdout).toContain("health");
  });
});
