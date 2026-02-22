import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(new URL("../../", import.meta.url).pathname);
const frontendDist = path.join(repoRoot, "frontend", "dist", "assets");
const budgetPath = path.join(repoRoot, "scripts", "perf", "perf-budget.config.json");

if (!fs.existsSync(frontendDist)) {
  console.error("Frontend dist assets not found. Run frontend build first.");
  process.exit(1);
}

const budget = JSON.parse(fs.readFileSync(budgetPath, "utf8"));
const files = fs.readdirSync(frontendDist);

const jsMain = files
  .filter((f) => f.startsWith("index-") && f.endsWith(".js"))
  .map((f) => ({ name: f, size: fs.statSync(path.join(frontendDist, f)).size }))
  .sort((a, b) => b.size - a.size)[0];

const cssMain = files
  .filter((f) => f.startsWith("index-") && f.endsWith(".css"))
  .map((f) => ({ name: f, size: fs.statSync(path.join(frontendDist, f)).size }))
  .sort((a, b) => b.size - a.size)[0];

if (!jsMain || !cssMain) {
  console.error("Could not locate main frontend JS/CSS bundles in dist/assets.");
  process.exit(1);
}

const jsKb = jsMain.size / 1024;
const cssKb = cssMain.size / 1024;

const failures = [];
if (jsKb > budget.frontend.maxMainJsKb) {
  failures.push(
    `Main JS bundle ${jsMain.name} is ${jsKb.toFixed(1)}KB (max ${budget.frontend.maxMainJsKb}KB)`
  );
}
if (cssKb > budget.frontend.maxMainCssKb) {
  failures.push(
    `Main CSS bundle ${cssMain.name} is ${cssKb.toFixed(1)}KB (max ${budget.frontend.maxMainCssKb}KB)`
  );
}

console.log(`Main JS: ${jsMain.name} ${jsKb.toFixed(1)}KB`);
console.log(`Main CSS: ${cssMain.name} ${cssKb.toFixed(1)}KB`);

if (failures.length > 0) {
  console.error("Performance budget check failed:\n" + failures.map((f) => `- ${f}`).join("\n"));
  process.exit(1);
}

console.log("Performance budget check passed.");
