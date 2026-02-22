import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";

describe("admin controls validation cli", () => {
  it("fails cleanly with network_error when target is unreachable", () => {
    const repoRoot = path.resolve(__dirname, "..", "..");
    const script = path.join(repoRoot, "scripts", "launch", "validate-admin-controls.mjs");

    const run = spawnSync("node", [script], {
      cwd: repoRoot,
      env: {
        ...process.env,
        LAUNCH_BASE_URL: "http://127.0.0.1:65534",
        LAUNCH_ADMIN_BEARER_TOKEN: "admin-token",
        LAUNCH_MEMBER_BEARER_TOKEN: "member-token",
      },
      encoding: "utf8",
    });

    const combined = `${run.stdout}\n${run.stderr}`;
    expect(run.status).toBe(1);
    expect(combined).toContain("Admin controls validation failed");
    expect(combined).toContain("network_error");
    expect(combined).toContain("security_sessions_admin");
    expect(combined).toContain("security_sessions_member");
  });
});
