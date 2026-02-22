import { spawnSync } from "node:child_process";

const runP1 = process.argv.includes("--p1");
const runVolumeSeed = process.argv.includes("--volume-seed") || process.env.LAUNCH_GATE_VOLUME_SEED === "true";
const runPostDeploySmoke = process.argv.includes("--post-deploy-smoke")
  || process.env.LAUNCH_POST_DEPLOY_SMOKE === "true";
const runAdminControlValidation = process.argv.includes("--validate-admin-controls")
  || process.env.LAUNCH_VALIDATE_ADMIN_CONTROLS === "true";
const dryRun = process.env.LAUNCH_GATE_DRY_RUN === "true";
const dryRunFailStep = process.env.LAUNCH_GATE_FAIL_STEP || "";

const steps = [
  {
    name: "migration_safety",
    cmd: "npm",
    args: ["run", "migrate:safety"],
    required: true,
  },
  {
    name: "contracts_freeze",
    cmd: "npm",
    args: ["run", "contracts:check"],
    required: true,
  },
  {
    name: "security_tests",
    cmd: "npm",
    args: ["run", "test:security"],
    required: true,
  },
  {
    name: "reliability_tests",
    cmd: "npm",
    args: ["run", "test:reliability"],
    required: true,
  },
  {
    name: "enterprise_e2e",
    cmd: "npm",
    args: ["run", "test:e2e:enterprise"],
    required: true,
  },
  {
    name: "backend_build",
    cmd: "npm",
    args: ["run", "build"],
    required: true,
  },
  {
    name: "frontend_build",
    cmd: "npm",
    args: ["--prefix", "frontend", "run", "build"],
    required: true,
  },
  {
    name: "launch_checklist",
    cmd: "npm",
    args: ["run", "launch:checklist"],
    required: true,
  },
];

if (runP1) {
  steps.push({
    name: "perf_budget",
    cmd: "npm",
    args: ["run", "perf:budget"],
    required: true,
  });
  steps.push({
    name: "perf_load",
    cmd: "npm",
    args: ["run", "perf:load"],
    required: true,
  });
  if (runVolumeSeed) {
    steps.push({
      name: "volume_seed",
      cmd: "npm",
      args: ["run", "db:seed:volume"],
      required: true,
    });
  }
}

if (runPostDeploySmoke) {
  steps.push({
    name: "post_deploy_smoke",
    cmd: "npm",
    args: ["run", "smoke:test"],
    required: true,
  });
}

if (runAdminControlValidation) {
  steps.push({
    name: "admin_control_validation",
    cmd: "npm",
    args: ["run", "launch:validate-admin-controls"],
    required: true,
  });
}

function runStep(step) {
  const started = Date.now();
  console.log(`\n==> [${step.name}] ${step.cmd} ${step.args.join(" ")}`);
  if (dryRun) {
    const shouldFail = dryRunFailStep === step.name;
    return {
      name: step.name,
      ok: !shouldFail,
      status: shouldFail ? 1 : 0,
      elapsedMs: Date.now() - started,
      required: step.required,
    };
  }
  const result = spawnSync(step.cmd, step.args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  const elapsedMs = Date.now() - started;
  const ok = result.status === 0;
  return {
    name: step.name,
    ok,
    status: result.status ?? 1,
    elapsedMs,
    required: step.required,
  };
}

const results = [];
for (const step of steps) {
  const r = runStep(step);
  results.push(r);
  if (!r.ok && step.required) {
    console.error(`\nRelease gate failed at step: ${step.name}`);
    break;
  }
}

console.log("\nRelease gate summary:");
for (const r of results) {
  const status = r.ok ? "PASS" : "FAIL";
  console.log(`- [${status}] ${r.name} (${(r.elapsedMs / 1000).toFixed(1)}s)`);
}

const failed = results.find((r) => !r.ok && r.required);
if (failed) {
  process.exit(1);
}

console.log("\nRelease gate passed.");
