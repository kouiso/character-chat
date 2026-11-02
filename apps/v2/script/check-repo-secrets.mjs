// SBI-01-3: repo とビルド成果物に資格情報らしき文字列が無いことの検査。
// - `.dev.vars*`・`.prod-verify.vars` が git の無視ルールで commit 不能であること
// - 追跡ファイル・ビルド成果物に鍵らしき文字列が無いこと
// 使い方: `pnpm --filter @v2/app secrets:check`
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const failures = [];
const fail = (message) => failures.push(message);

// git の hook から走ると GIT_DIR・GIT_WORK_TREE などが別の repo を指したまま渡り、cwd より優先される。
// 渡ったまま呼ぶと別の repo の追跡一覧を検査して通すので外す。
const gitEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
);

// 終了コードが 0 以外だと execFileSync が投げる。終了コードを見たい呼び出しは runAllowFail を使う。
const git = (args) =>
  execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    env: gitEnv,
  });

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
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, "AWS アクセスキー"],
  [/\b[sr]k_live_[0-9A-Za-z]{20,}/g, "Stripe 本番鍵"],
  [/\bgh[ousr]_[A-Za-z0-9]{30,}/g, "GitHub トークン"],
];
// KEY=値 形式は「明らかに鍵らしい形」だけを拾う（誤検知で検査自体を無効化せんため）。
// 人が決めるパスワードは短いので 8 字から見る。短い値は英小文字+英大文字+数字の 3 種が揃う時だけ、
// 生成された鍵は小文字と数字だけのことが多いので、長い値は区切りの少ない英字+数字で拾う。
// `process.env.X` 等の参照・`"images/..."` のようなパス・UUID・テスト用語は弾く。
// JSON の `"NAME": "値"` も拾えるよう、名前の後ろの引用符を許す。
// YAML や設定の `openrouter_api_key: 値` のような小文字の snake_case も拾う。`sloSpeedPass` のような
// camelCase の変数名まで拾うと誤検知で検査が止まるので、小文字は `_key` などで終わる名前だけにする。
const ASSIGNMENT =
  /\b([A-Z][A-Z0-9_]{3,}(?:KEY|TOKEN|SECRET|PASSWORD|PASS)|[a-z][a-z0-9_]*_(?:key|token|secret|password|pass))\b["']?\s*[:=]\s*["']?([^\s"'\n,}]{8,})/g;
const PLACEHOLDER =
  /placeholder|change[-_]?me|xxx+|example|dummy|codex-local|your[-_]|<|\$\{|\.\.\.|test[-_]/i;
const NOT_SECRET_VALUE = /^(?:process\.|import\.|env\.|node:|[@./$]|.*\/)/;
const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hasMixedCase = (value) => /[a-z]/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value);
// `chat-history-v2` のような区切りつきの名前を鍵と取り違えんよう、長い値は区切りが少なく
// 数字が混ざって詰まったものだけを鍵とみなす。
const looksGeneratedKey = (value) =>
  value.length >= 24 &&
  /[A-Za-z]/.test(value) &&
  /[0-9]/.test(value) &&
  (value.match(/[-_.]/g) ?? []).length <= 2;
const looksTokenLike = (value) =>
  /^[A-Za-z0-9_\-+.]+$/.test(value) && (hasMixedCase(value) || looksGeneratedKey(value));
// `scheme://ユーザー:パスワード@ホスト` の形。`${...}` やプレースホルダは弾く。
const URL_CREDENTIAL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@"'<>]+:([^\s/@"'<>]{6,})@[^\s/"'<>]/gi;
const looksLikePassword = (value) =>
  !PLACEHOLDER.test(value) && /[A-Za-z]/.test(value) && (/[0-9]/.test(value) || value.length >= 16);
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----([\s\S]*?)-----END/m;

// 検査結果は CI の公開ログに出るので、見つけた値は一文字も出さず「どこの何」だけを示す。
const lineOf = (text, index) => text.slice(0, index).split("\n").length;

const scan = (path, text) => {
  for (const [pattern, label] of BODY_PATTERNS) {
    pattern.lastIndex = 0;
    const found = pattern.exec(text);
    if (found) fail(`${label}らしき文字列: ${path}:${lineOf(text, found.index)}`);
  }
  ASSIGNMENT.lastIndex = 0;
  let match;
  while ((match = ASSIGNMENT.exec(text))) {
    const value = match[2].replace(/["'`;]+$/, "");
    if (
      !PLACEHOLDER.test(value) &&
      !NOT_SECRET_VALUE.test(value) &&
      !UUID_LIKE.test(value) &&
      looksTokenLike(value)
    ) {
      fail(`秘密変数への代入らしき行: ${path}:${lineOf(text, match.index)} (${match[1]})`);
    }
  }
  URL_CREDENTIAL.lastIndex = 0;
  let url;
  while ((url = URL_CREDENTIAL.exec(text))) {
    if (looksLikePassword(url[1])) {
      fail(`URL に埋めた資格情報らしき文字列: ${path}:${lineOf(text, url.index)}`);
    }
  }
  PRIVATE_KEY.lastIndex = 0;
  const keyMatch = PRIVATE_KEY.exec(text);
  if (keyMatch && keyMatch[1].replace(/\s+/g, "").length >= 120) {
    fail(`秘密鍵ブロックらしき文字列: ${path}:${lineOf(text, keyMatch.index)}`);
  }
};

const TEXT_FILE = /\.(mjs|cjs|js|jsx|ts|tsx|json|jsonc|toml|yml|yaml|md|txt|sh|py|sql|vars|example|env)$/i;
for (const path of tracked) {
  if (!TEXT_FILE.test(path)) continue;
  let text;
  try {
    // URL として読むと # ? % を含む名前が別のファイルになる。ファイルのパスとして読む。
    text = readFileSync(join(root, path), "utf8");
  } catch (error) {
    // 追跡一覧にあって作業ツリーに無い（消した直後・submodule）ものだけ飛ばす。
    // ほかの理由で読めんのを飛ばすと、検査されんまま通る。
    if (error.code === "ENOENT" || error.code === "EISDIR") continue;
    throw error;
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
    scan(`build:${path}`, readFileSync(join(root, path), "utf8"));
  }
}

if (failures.length > 0) {
  console.error(`資格情報検査: ${failures.length} 件の問題`);
  for (const message of failures) console.error(`  - ${message}`);
  process.exit(1);
}
console.log(`資格情報検査: OK（追跡 ${tracked.length} ファイル、無視ルール ${mustBeIgnored.length} 件確認）`);
