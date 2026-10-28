// SBI-01-3: repo とビルド成果物に資格情報らしき文字列が無いことの検査。
// - `.dev.vars*`・`.prod-verify.vars` が git の無視ルールで commit 不能であること
// - 追跡ファイル・ビルド成果物に鍵らしき文字列が無いこと
// 使い方: `pnpm --filter @v2/app secrets:check`
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const failures = [];
const fail = (message) => failures.push(message);

const git = (args, okCodes = [0]) => {
  const result = execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    env: process.env,
    // execFileSync throws on non-zero; capture via try/catch instead
  });
  return result;
};

const runAllowFail = (args) => {
  try {
    return { code: 0, out: git(args) };
  } catch (error) {
    return { code: error.status ?? 1, out: (error.stdout ?? "") + (error.stderr ?? "") };
  }
};

// --- 1. 無視ルール: わざと置いても commit 対象に乗らんこと ---
const mustBeIgnored = [
  ".dev.vars",
  ".dev.vars.production",
  "apps/v2/.dev.vars",
  "apps/v2/.dev.vars.local",
  "functions/.dev.vars",
  ".prod-verify.vars",
];
for (const path of mustBeIgnored) {
  const result = runAllowFail(["check-ignore", "-q", path]);
  if (result.code !== 0) fail(`git の無視ルールに無い: ${path}`);
}

// --- 2. 追跡ファイルに秘密ファイル名が無いこと ---
const tracked = git(["ls-files", "-z"]).split("\0").filter(Boolean);
const forbiddenName = /(^|\/)\.dev\.vars|\.prod-verify\.vars$|(^|\/)\.env(?!\.example$)/;
for (const path of tracked) {
  if (forbiddenName.test(path)) fail(`追跡対象に秘密ファイル: ${path}`);
}

// --- 3. 追跡ファイル・ビルド成果物の中身 ---
// 誤検知を避けるため、判別しやすい形のものだけを見る。
const BODY_PATTERNS = [
  [/sk-or-v1-[0-9a-fA-F]{32,}/g, "OpenRouter 鍵"],
  [/sk-proj-[A-Za-z0-9_-]{20,}/g, "OpenAI 鍵"],
  [/sk-ant-[A-Za-z0-9_-]{20,}/g, "Anthropic 鍵"],
  [/xox[baprs]-[0-9A-Za-z-]{10,}/g, "Slack トークン"],
  [/hooks\.slack\.com\/services\/[A-Za-z0-9/]+/g, "Slack webhook"],
  [/ghp_[A-Za-z0-9]{30,}/g, "GitHub PAT"],
  [/github_pat_[A-Za-z0-9_]{30,}/g, "GitHub PAT"],
  [/AIza[0-9A-Za-z_-]{35}/g, "Google API 鍵"],
];
// KEY=値 形式は「明らかに鍵らしい形」だけを拾う（誤検知で検査自体を無効化せんため）:
// 値が引用符 or 裸のリテラルで 20 字以上・英数系のみ・英小文字+英大文字+数字の 3 種を含む。
// `process.env.X` 等の参照・`"images/..."` のようなパス・UUID・テスト用語は弾く。
const ASSIGNMENT =
  /\b[A-Z][A-Z0-9_]{3,}(?:KEY|TOKEN|SECRET|PASSWORD|PASS)\b\s*[:=]\s*["']?([^\s"'\n,}]{20,})/g;
const PLACEHOLDER =
  /placeholder|change[-_]?me|xxx+|example|dummy|codex-local|your[-_]|<|\$\{|\.\.\.|test[-_]/i;
const NOT_SECRET_VALUE = /^(?:process\.|import\.|env\.|node:|[@./$]|.*\/)/;
const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const looksTokenLike = (value) =>
  /^[A-Za-z0-9_\-+.]+$/.test(value) &&
  /[a-z]/.test(value) &&
  /[A-Z]/.test(value) &&
  /[0-9]/.test(value);
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----([\s\S]*?)-----END/m;

const scan = (path, text) => {
  for (const [pattern, label] of BODY_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) fail(`${label}らしき文字列: ${path}`);
  }
  ASSIGNMENT.lastIndex = 0;
  let match;
  while ((match = ASSIGNMENT.exec(text))) {
    const value = match[1].replace(/["'`;]+$/, "");
    if (
      !PLACEHOLDER.test(value) &&
      !NOT_SECRET_VALUE.test(value) &&
      !UUID_LIKE.test(value) &&
      looksTokenLike(value)
    ) {
      fail(`秘密変数への代入らしき行: ${path} (${match[0].slice(0, 40)}…)`);
    }
  }
  PRIVATE_KEY.lastIndex = 0;
  const keyMatch = PRIVATE_KEY.exec(text);
  if (keyMatch && keyMatch[1].replace(/\s+/g, "").length >= 120) {
    fail(`秘密鍵ブロックらしき文字列: ${path}`);
  }
};

const TEXT_FILE = /\.(mjs|cjs|js|jsx|ts|tsx|json|jsonc|toml|yml|yaml|md|txt|sh|py|sql|vars|example|env)$/i;
for (const path of tracked) {
  if (!TEXT_FILE.test(path)) continue;
  let text;
  try {
    text = readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
  } catch {
    continue;
  }
  scan(`tracked:${path}`, text);
}

for (const dir of ["apps/v2/dist", "apps/v2/.output", "dist"]) {
  const base = new URL(`../../../${dir}/`, import.meta.url);
  if (!existsSync(base)) continue;
  const files = execFileSync("find", [dir, "-type", "f"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .filter((path) => TEXT_FILE.test(path));
  for (const path of files) {
    scan(`build:${path}`, readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8"));
  }
}

if (failures.length > 0) {
  console.error(`資格情報検査: ${failures.length} 件の問題`);
  for (const message of failures) console.error(`  - ${message}`);
  process.exit(1);
}
console.log(`資格情報検査: OK（追跡 ${tracked.length} ファイル、無視ルール ${mustBeIgnored.length} 件確認）`);
