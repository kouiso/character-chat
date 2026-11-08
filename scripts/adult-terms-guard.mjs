#!/usr/bin/env node
// 公開 repo に成人向けの語が新たに混入したら止める ratchet 検査（RIT-93）。
// 既存のヒットは baseline に記録済みで成長だけを止める。掃討するときは
// `--write-baseline` で基準を更新する（減った側は自動で追従せんので手動更新）。
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const TERMS_PATH = join(root, ".github/adult-terms.txt");
const BASELINE_PATH = join(root, ".github/adult-terms-baseline.json");
// 検査自身が拒否語を持つので走査対象から外す。外さんと自己参照で必ず止まる。
const SELF_FILES = new Set([
  ".github/adult-terms.txt",
  ".github/adult-terms-baseline.json",
  "scripts/adult-terms-guard.mjs",
  "scripts/adult-terms-guard.test.ts",
]);
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export const loadTerms = (text) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

const isBinary = (buffer) => buffer.subarray(0, 8192).includes(0);

// 戻り値: { "path": { "term": count } }。term は小文字に正規化する。
export const scanFiles = (files, terms) => {
  const hits = {};
  for (const { path, content } of files) {
    const haystack = content.toLowerCase();
    for (const term of terms) {
      const needle = term.toLowerCase();
      let count = 0;
      let at = haystack.indexOf(needle);
      while (at !== -1) {
        count += 1;
        at = haystack.indexOf(needle, at + needle.length);
      }
      if (count > 0) {
        (hits[path] ??= {})[term] = count;
      }
    }
  }
  return hits;
};

const trackedFiles = () =>
  execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0")
    .filter(Boolean)
    .filter((path) => !SELF_FILES.has(path));

const readContents = () =>
  trackedFiles()
    .map((path) => {
      try {
        const content = readFileSync(join(root, path));
        if (content.length > MAX_FILE_BYTES || isBinary(content)) return null;
        return { path, content: content.toString("utf8") };
      } catch {
        return null;
      }
    })
    .filter(Boolean);

// baseline を超えた分だけを違反として返す。
export const findViolations = (hits, baseline) => {
  const violations = [];
  for (const [path, terms] of Object.entries(hits)) {
    for (const [term, count] of Object.entries(terms)) {
      const allowed = baseline[path]?.[term] ?? 0;
      if (count > allowed) violations.push({ path, term, count, allowed });
    }
  }
  return violations;
};

const main = () => {
  const terms = loadTerms(readFileSync(TERMS_PATH, "utf8"));
  const hits = scanFiles(readContents(), terms);
  if (process.argv.includes("--write-baseline")) {
    writeFileSync(BASELINE_PATH, `${JSON.stringify(hits, null, 2)}\n`);
    console.log(`baseline updated: ${Object.keys(hits).length} files`);
    return;
  }
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  const violations = findViolations(hits, baseline);
  if (violations.length === 0) {
    console.log("adult-terms-guard: ok（新規混入なし）");
    return;
  }
  console.error("adult-terms-guard: 成人向けの語の新規混入を検出");
  for (const v of violations) {
    console.error(`  ${v.path}: 「${v.term}」x${v.count}（基準 ${v.allowed}）`);
  }
  console.error("既存箇所の掃討が目的なら `node scripts/adult-terms-guard.mjs --write-baseline`");
  process.exit(1);
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
