import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const requiredFiles = ["wrangler.toml", "package.json", "README.md"] as const;
const workflowDir = ".github/workflows";

const workflowFiles = readdirSync(workflowDir)
  .map((name) => join(workflowDir, name))
  .filter((path) => statSync(path).isFile() && /\.ya?ml$/i.test(path));

const failures: string[] = [];

for (const file of requiredFiles) {
  if (!existsSync(file)) failures.push(`Missing required file: ${file}`);
}

const wranglerToml = readFileSync("wrangler.toml", "utf8");
if (!/^\s*name\s*=\s*"[^"]+"/m.test(wranglerToml)) {
  failures.push("wrangler.toml must define a Pages project name.");
}
if (!/^\s*compatibility_date\s*=\s*"\d{4}-\d{2}-\d{2}"/m.test(wranglerToml)) {
  failures.push("wrangler.toml must pin a compatibility_date.");
}

const packageJson = readFileSync("package.json", "utf8");
if (!/"deploy"\s*:\s*"wrangler pages deploy dist"/.test(packageJson)) {
  failures.push("package.json must keep local deploy script using wrangler pages deploy dist.");
}

const secretLeakPatterns = [
  /echo\s+\${{\s*secrets\./i,
  /::add-mask::\${{\s*secrets\./i,
  /cat\s+.*\${{\s*secrets\./i,
  /printenv\b/i,
] as const;

const workflowLeaks = workflowFiles.flatMap((path) => {
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  return lines.flatMap((line, index) =>
    secretLeakPatterns.some((pattern) => pattern.test(line))
      ? [`${path}:${index + 1}: ${line.trim()}`]
      : [],
  );
});

if (workflowLeaks.length > 0) {
  failures.push(
    "Potential secret exposure pattern found in workflow(s):\n" + workflowLeaks.join("\n"),
  );
}

if (failures.length > 0) {
  console.error(["Cloudflare Pages deploy readiness check failed.", "", ...failures].join("\n"));
  process.exit(1);
}

console.log(
  [
    "Cloudflare Pages deploy readiness: PASS",
    `Required files present: ${requiredFiles.join(", ")}`,
    `Checked ${workflowFiles.length} workflow file(s) for secret-exposure patterns.`,
  ].join("\n"),
);
