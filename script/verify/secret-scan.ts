import { spawnSync } from "node:child_process";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const TOKEN_PATTERNS = [
  "sk-(or-v1|ant-api[0-9]+)-[A-Za-z0-9_-]{20,}",
  "gh[pousr]_[A-Za-z0-9]{36,}",
  "github_pat_[A-Za-z0-9_]{40,}",
];
const PEM_HEADER_PATTERN = "-----BEGIN ([A-Z]+ )?PRIVATE KEY-----";
const CANDIDATE_PATTERN = [...TOKEN_PATTERNS, PEM_HEADER_PATTERN].join("|");
const TOKEN = new RegExp(TOKEN_PATTERNS.join("|"));
const PEM_HEADER = new RegExp(PEM_HEADER_PATTERN);
const PEM_WITH_PAYLOAD = new RegExp(`${PEM_HEADER_PATTERN}(?:\\s|\\\\[nr])*[A-Za-z0-9+/]{32,}`);

const matchesSecret = (content: string): boolean =>
  TOKEN.test(content) || PEM_WITH_PAYLOAD.test(content);

const redactPath = (file: string): string => {
  const headerIndex = file.search(PEM_HEADER);
  const safePath = headerIndex < 0 ? file : `${file.slice(0, headerIndex)}[REDACTED]`;
  return safePath.replace(new RegExp(TOKEN_PATTERNS.join("|"), "g"), "[REDACTED]");
};

const isSecretFile = (file: string): boolean => {
  const name = basename(file);
  if ([".env.example", ".dev.vars.example"].includes(name)) return false;
  return name.startsWith(".dev.vars") || /^\.env(\.|$)/.test(name) || name === ".prod-verify.vars";
};

const git = (cwd: string, args: string[], allowNoMatch = false): string => {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.error || (result.status !== 0 && !(allowNoMatch && result.status === 1))) {
    // Git のエラー本文にファイル内容が含まれる可能性があるため、そのまま表示しない。
    throw new Error("Git の検査に失敗しました。検査を省略せず、作業ツリーを確認してください。");
  }
  return result.stdout;
};

export const scanIndex = (cwd: string): string[] => {
  const files = git(cwd, ["ls-files", "--cached", "-z"]).split("\0").filter(Boolean);
  const candidates = git(cwd, ["grep", "--cached", "-alz", "-E", CANDIDATE_PATTERN, "--"], true)
    .split("\0")
    .filter(Boolean);
  const found = files.filter(isSecretFile);
  for (const file of candidates) {
    if (matchesSecret(git(cwd, ["show", `:${file}`]))) found.push(file);
  }
  return [...new Set(found)].sort();
};

export const scanArtifact = (directory: string): string[] => {
  const found: string[] = [];
  const visit = (file: string) => {
    const stat = lstatSync(file);
    if (stat.isSymbolicLink()) {
      found.push(file);
    } else if (stat.isDirectory()) {
      for (const name of readdirSync(file)) visit(join(file, name));
    } else if (!stat.isFile() || isSecretFile(file) || matchesSecret(readFileSync(file, "utf8"))) {
      found.push(file);
    }
  };
  visit(directory);
  return found.sort();
};

export const run = (args: string[], cwd = process.cwd()): number => {
  try {
    if (args.length !== 0 && (args.length !== 2 || args[0] !== "--artifact")) {
      console.error("使い方: pnpm verify:secrets [--artifact ビルド先]");
      return 2;
    }
    if (args.length === 2 && !args[1]) {
      console.error("使い方: pnpm verify:secrets [--artifact ビルド先]");
      return 2;
    }
    const found = scanIndex(cwd);
    if (args[1]) found.push(...scanArtifact(resolve(cwd, args[1])));
    if (found.length > 0) {
      console.error("資格情報の疑いがあるファイル（本文・値は表示しません）:");
      for (const file of found) {
        console.error(JSON.stringify(redactPath(file)));
      }
      return 1;
    }
    console.log("資格情報ファイル・対応するキー形式の混入検査に通りました。");
    return 0;
  } catch {
    console.error("資格情報の検査に失敗しました。Git またはビルド先を確認してください。");
    return 2;
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = run(process.argv.slice(2));
}
