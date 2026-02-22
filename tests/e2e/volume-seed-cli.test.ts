import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";

describe("volume seed cli", () => {
  it("supports dry-run without database connectivity", () => {
    const repoRoot = path.resolve(__dirname, "..", "..");
    const script = path.join(repoRoot, "scripts", "load", "seed-staging-volume.mjs");

    const run = spawnSync("node", [script, "--dry-run"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        SEED_EMPLOYEES: "120",
        SEED_ACCOUNTS: "80",
        SEED_CALLS_PER_ACCOUNT: "2",
        SEED_STORIES_PER_ACCOUNT: "1",
        SEED_PAGES_PER_STORY: "1",
      },
      encoding: "utf8",
    });

    const output = `${run.stdout}\n${run.stderr}`;
    expect(run.status).toBe(0);
    expect(output).toContain("Staging volume seed dry-run complete");
    expect(output).toContain("users: +120");
    expect(output).toContain("accounts: +80");
    expect(output).toContain("calls: +160");
    expect(output).toContain("stories: +80");
  });
});
