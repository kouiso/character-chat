import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const WORKFLOW_DIR = ".github/workflows";

const FORBIDDEN_DEPLOY_PATTERNS = [
  /wrangler\s+pages\s+deploy/i,
  /cloudflare\/pages-action/i,
  /\bpages\s+deploy\b/i,
  /deploy-once/i,
] as const;

const workflowFiles = readdirSync(WORKFLOW_DIR)
  .map((name) => join(WORKFLOW_DIR, name))
  .filter((path) => statSync(path).isFile() && /\.ya?ml$/i.test(path));

const violations = workflowFiles.flatMap((path) => {
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  return lines.flatMap((line, index) =>
    FORBIDDEN_DEPLOY_PATTERNS.some((pattern) => pattern.test(line))
      ? [`${path}:${index + 1}: ${line.trim()}`]
      : [],
  );
});

if (violations.length > 0) {
  console.error(
    [
      "GitHub Actions must not deploy adult-ai-app.",
      "Use Cloudflare Pages Git integration or local `pnpm run deploy` / `wrangler pages deploy` instead.",
      "",
      ...violations,
    ].join("\n"),
  );
  process.exit(1);
}

console.log(
  `Verified ${workflowFiles.length} workflow files: no GitHub Actions Pages deploy path.`,
);
