#!/usr/bin/env tsx
/**
 * build-score-index.ts — スコア索引ビルダー (Phase 1)
 * 出力: evals/score-index.jsonl (git 追跡・軽量テキスト)
 * image_ref / drive_file_id は Phase 2 (Drive 退避後) に埋める
 *
 * 取り込み元:
 *   1. .work/e2e-results/runs/*\/manifest.json  (rubricScore per scenario — 主ソース)
 *   2. .work/e2e-results/ab-*-scored.json       (旧フラット形式 / 3件)
 *   3. ~/.claude/.../memory/avatar-scoring-history-full.md (アバター採点)
 *   4. .work/seeds/images/**\/*.md               (provenance: R2 key/seed/prompt)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ── 型定義 ─────────────────────────────────────────────────────────────────

interface ScoreEntry {
  type: "eval" | "image";
  id: string;
  date: string;
  char: string;
  label: string;
  scenario: string;
  scores: {
    sceneAlignment?: number;
    eroticDensity?: number;
    characterConsistency?: number;
    escalationNaturalness?: number;
    noMetaRemarks?: number;
    subtextInterpretation?: number;
    bonuses?: { creampie?: number; afterglow?: number; image?: number };
    eventWeightedTotal?: number;
    rawTotal?: number;
  };
  judgment: "PASS" | "FAIL" | "unknown";
  score: number;
  notes: string;
  image_ref: string;
  drive_file_id: string;
  source: string;
}

// ── パス定数 ──────────────────────────────────────────────────────────────

const REPO_ROOT = process.cwd();
const E2E_RUNS_DIR = path.join(REPO_ROOT, ".work/e2e-results/runs");
const E2E_DIR = path.join(REPO_ROOT, ".work/e2e-results");
const SEEDS_IMAGES_DIR = path.join(REPO_ROOT, ".work/seeds/images");
const AVATAR_HISTORY_PATH = path.join(
  os.homedir(),
  ".claude/projects/-home-kouiso-ghq-kouiso-adult-ai-app/memory/avatar-scoring-history-full.md"
);
const OUTPUT_DIR = path.join(REPO_ROOT, "evals");
const OUTPUT_PATH = path.join(OUTPUT_DIR, "score-index.jsonl");

// ── ユーティリティ ────────────────────────────────────────────────────────

function tryReadJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

function walkFiles(dir: string, exts: string[]): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  function recurse(current: string) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) recurse(full);
      else if (entry.isFile() && exts.some((e) => full.endsWith(e))) results.push(full);
    }
  }
  recurse(dir);
  return results;
}

function runDirManifests(): string[] {
  if (!fs.existsSync(E2E_RUNS_DIR)) return [];
  return fs
    .readdirSync(E2E_RUNS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(E2E_RUNS_DIR, e.name, "manifest.json"))
    .filter((p) => fs.existsSync(p));
}

function abScoredFiles(): string[] {
  if (!fs.existsSync(E2E_DIR)) return [];
  return fs
    .readdirSync(E2E_DIR)
    .filter((n) => n.startsWith("ab-") && n.endsWith("-scored.json"))
    .map((n) => path.join(E2E_DIR, n));
}

// ── ソース 1: manifest.json ───────────────────────────────────────────────

interface ManifestScenario {
  scenarioId: string;
  status?: string;
  startedAt?: string;
  completedAt?: string;
  characterSlug?: string;
  terminationReason?: string | null;
  rubricScore?: {
    sceneAlignment?: number;
    eroticDensity?: number;
    characterConsistency?: number;
    escalationNaturalness?: number;
    noMetaRemarks?: number;
    subtextInterpretation?: number;
    bonuses?: { creampie?: number; afterglow?: number; image?: number };
    eventWeightedTotal?: number;
    rawTotal?: number;
  };
  // 旧フラット形式
  eroticDensity?: number;
  charConsistency?: number;
  eventWeightedTotal?: number;
  rawTotal?: number;
}

interface ManifestJson {
  model?: string;
  runId?: string;
  date?: string;
  status?: string;
  scenarios?: ManifestScenario[];
}

function parseManifests(): ScoreEntry[] {
  const entries: ScoreEntry[] = [];
  const files = runDirManifests();
  let loaded = 0;

  for (const file of files) {
    const manifest = tryReadJson<ManifestJson>(file);
    if (!manifest) continue;

    const runId = manifest.runId ?? path.basename(path.dirname(file));

    // runId 形式: "run-YYYYMMDD-HHMMSS-..." → YYYY-MM-DD に変換
    const rawDate = runId.slice(4, 12); // "20260507"
    const runDate =
      manifest.date ??
      (rawDate.length === 8 ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}` : "");
    loaded++;

    for (const s of manifest.scenarios ?? []) {
      const rs = s.rubricScore;
      let scores: ScoreEntry["scores"] = {};

      if (rs && typeof rs === "object" && Object.keys(rs).length > 0) {
        scores = {
          sceneAlignment: rs.sceneAlignment,
          eroticDensity: rs.eroticDensity,
          characterConsistency: rs.characterConsistency,
          escalationNaturalness: rs.escalationNaturalness,
          noMetaRemarks: rs.noMetaRemarks,
          subtextInterpretation: rs.subtextInterpretation,
          bonuses: rs.bonuses,
          eventWeightedTotal: rs.eventWeightedTotal,
          rawTotal: rs.rawTotal,
        };
      } else if (s.eventWeightedTotal != null || s.eroticDensity != null) {
        // 旧フラット形式
        scores = {
          eroticDensity: s.eroticDensity,
          characterConsistency: s.charConsistency,
          eventWeightedTotal: s.eventWeightedTotal,
          rawTotal: s.rawTotal,
        };
      }

      if (Object.keys(scores).length === 0) continue;

      const total = scores.eventWeightedTotal ?? scores.rawTotal ?? 0;
      const judgment: ScoreEntry["judgment"] =
        s.status === "completed" || s.status === "passed" ? "PASS" : "unknown";

      entries.push({
        type: "eval",
        id: `${runId}:${s.scenarioId}`,
        date: runDate,
        char: s.characterSlug ?? "",
        label: "",
        scenario: s.scenarioId,
        scores,
        judgment,
        score: total,
        notes: s.terminationReason ? `status:${s.status} — ${String(s.terminationReason).slice(0, 80)}` : `status:${s.status ?? "?"}`,
        image_ref: `gdrive:evals/${runDate.slice(0, 7)}/${runId}/`,
        drive_file_id: "",
        source: path.relative(REPO_ROOT, file),
      });
    }
  }

  console.log(`[1] manifest.json: ${files.length} files, ${loaded} loaded, ${entries.length} entries`);
  return entries;
}

// ── ソース 2: ab-*-scored.json ─────────────────────────────────────────────

interface AbScoredScenario {
  scenarioId: string;
  status?: string;
  eroticDensity?: number;
  charConsistency?: number;
  eventWeightedTotal?: number;
  rawTotal?: number;
}

interface AbScoredJson {
  model?: string;
  runDir?: string;
  status?: string;
  scenarios?: AbScoredScenario[];
}

function parseAbScored(): ScoreEntry[] {
  const entries: ScoreEntry[] = [];
  const files = abScoredFiles();

  for (const file of files) {
    const data = tryReadJson<AbScoredJson>(file);
    if (!data) continue;

    const fileName = path.basename(file, ".json");
    const model = data.model ?? fileName.replace(/^ab-|-scored$/, "");
    const runId = data.runDir ? path.basename(data.runDir) : fileName;

    for (const s of data.scenarios ?? []) {
      const scores: ScoreEntry["scores"] = {
        eroticDensity: s.eroticDensity,
        // charConsistency → characterConsistency 正規化
        characterConsistency: s.charConsistency,
        eventWeightedTotal: s.eventWeightedTotal,
        rawTotal: s.rawTotal,
      };

      if (Object.keys(scores).every((k) => scores[k as keyof typeof scores] == null)) continue;

      const total = s.eventWeightedTotal ?? s.rawTotal ?? 0;

      entries.push({
        type: "eval",
        id: `ab:${runId}:${s.scenarioId}`,
        date: "",
        char: "",
        label: "",
        scenario: s.scenarioId,
        scores,
        judgment: s.status === "completed" ? "PASS" : "unknown",
        score: total,
        notes: `model:${model} status:${s.status ?? "?"}`,
        image_ref: "",
        drive_file_id: "",
        source: path.relative(REPO_ROOT, file),
      });
    }
  }

  console.log(`[2] ab-scored: ${files.length} files, ${entries.length} entries`);
  return entries;
}

// ── ソース 3: avatar-scoring-history-full.md ──────────────────────────────

const PIPE_LINE_RE =
  /^(\d{4}-\d{2}-\d{2})\s*\|\s*([A-Z]{1,2})\s*\|\s*([^\|]+?)\s*\|\s*(\d+(?:\.\d+)?)点\s*(PASS|FAIL)([^\n]*)/;


// キャラ名を相対パスから推定
function guessCharFromPath(p: string): string {
  if (p.includes("downer") || p.includes("ダウナー")) return "downer";
  if (p.includes("yakobus") || p.includes("夜行バス")) return "yakobus";
  if (p.includes("iris") || p.includes("アイリス")) return "iris";
  if (p.includes("sakura") || p.includes("さくら")) return "sakura";
  if (p.includes("adoadstra") || p.includes("アドアストラ")) return "adoadstra";
  if (p.includes("koharu") || p.includes("こはる")) return "koharu";
  return "";
}

function parseAvatarHistory(): ScoreEntry[] {
  const entries: ScoreEntry[] = [];

  if (!fs.existsSync(AVATAR_HISTORY_PATH)) {
    console.log("[3] avatar-history: file not found, skipping");
    return entries;
  }

  const text = fs.readFileSync(AVATAR_HISTORY_PATH, "utf-8");
  const lines = text.split("\n");

  // パターン A: pipe 区切り構造化行
  for (const line of lines) {
    const m = line.match(PIPE_LINE_RE);
    if (!m) continue;
    const [, date, label, descRaw, scoreStr, judgStr, noteRaw] = m;
    const score = parseFloat(scoreStr);
    const judgment = judgStr === "PASS" ? "PASS" : "FAIL";
    const desc = descRaw.trim();
    const char = guessCharFromPath(desc);
    const relPath = desc.split(" ")[0];

    entries.push({
      type: "image",
      id: `avatar:${date}:${label}`,
      date,
      char,
      label,
      scenario: "",
      scores: {},
      judgment,
      score,
      notes: noteRaw.trim().replace(/^\(|\)$/g, ""),
      image_ref: "",
      drive_file_id: "",
      source: path.relative(os.homedir(), AVATAR_HISTORY_PATH) + `#${relPath}`,
    });
  }

  console.log(`[3] avatar-history: ${entries.length} pipe-format entries`);
  return entries;
}

// ── ソース 4: .work/seeds/images/**/*.md ─────────────────────────────────

function parseSeedMds(): ScoreEntry[] {
  const entries: ScoreEntry[] = [];
  const mdFiles = walkFiles(SEEDS_IMAGES_DIR, [".md"]);

  for (const file of mdFiles) {
    const text = fs.readFileSync(file, "utf-8");
    const basename = path.basename(file, ".md");

    // 共通フィールド
    let char = "";
    let date = "";
    let r2Key = "";
    let messageId = "";
    let seed = "";
    let score = 0;
    let judgment: ScoreEntry["judgment"] = "unknown";
    let notes = "";

    // フォーマット A: `# 種別: image` 形式
    const charMatchA = text.match(/^#\s*キャラ[:：]\s*(.+)/m);
    const dateMatchA = text.match(/^#\s*生成日時[:：]\s*(.+)/m);
    const msgIdMatch = text.match(/^#\s*message_id[:：]\s*(\S+)/m);
    const r2KeyMatch = text.match(/^#+\s*R2 key\s*\n+([^\n]+)/m);
    const seedMatch = text.match(/^#+\s*Seed\s*\n+([^\n]+)/m);

    if (charMatchA) char = charMatchA[1].trim();
    if (dateMatchA) {
      const d = dateMatchA[1].trim();
      date = d.slice(0, 10).replace("T", "");
    }
    if (msgIdMatch) messageId = msgIdMatch[1].trim();
    if (r2KeyMatch) r2Key = r2KeyMatch[1].trim();
    if (seedMatch) seed = seedMatch[1].trim();

    // フォーマット B: `## 生成情報` 形式
    if (!char) {
      const titleMatch = text.match(/^#\s+(.+)/m);
      if (titleMatch) {
        const title = titleMatch[1];
        char = guessCharFromPath(title);
        const scoreInTitle = title.match(/(\d+)点/);
        if (scoreInTitle) {
          score = parseInt(scoreInTitle[1], 10);
          judgment = title.includes("採用") ? "PASS" : "unknown";
        }
      }
    }

    if (!date) {
      const dateMatchB = text.match(/^-\s*日付[:：]\s*(\d{4}-\d{2}-\d{2})/m);
      if (dateMatchB) date = dateMatchB[1];
      else date = basename.slice(0, 10).replace(/[_]/g, "-");
    }

    if (!r2Key) {
      const r2MatchB = text.match(/^-\s*r2_key[:：]\s*(\S+)/m);
      if (r2MatchB) r2Key = r2MatchB[1];
    }

    if (!seed) {
      const seedMatchB = text.match(/^-\s*seed[:：]\s*(\S+)/m);
      if (seedMatchB) seed = seedMatchB[1];
    }

    const modelMatch = text.match(/^-\s*モデル[:：]\s*(.+)/m);
    if (modelMatch) notes = `model:${modelMatch[1].trim()}`;
    if (seed && seed !== "(not recorded — generated before 0009 migration)") {
      notes += ` seed:${seed}`;
    }
    if (messageId) notes += ` message_id:${messageId}`;

    entries.push({
      type: "image",
      id: `seed:${basename}`,
      date: date.slice(0, 10),
      char,
      label: "",
      scenario: "",
      scores: {},
      judgment,
      score,
      notes: notes.trim(),
      image_ref: r2Key ? `r2:${r2Key}` : "",
      drive_file_id: "",
      source: path.relative(REPO_ROOT, file),
    });
  }

  console.log(`[4] seed mds: ${mdFiles.length} files, ${entries.length} entries`);
  return entries;
}

// ── メイン ────────────────────────────────────────────────────────────────

function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const allEntries: ScoreEntry[] = [
    ...parseManifests(),
    ...parseAbScored(),
    ...parseAvatarHistory(),
    ...parseSeedMds(),
  ];

  // 重複排除 (id で dedup)
  const seen = new Set<string>();
  const deduped = allEntries.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });

  // scores が完全に空の eval エントリを警告
  let emptyScores = 0;
  for (const e of deduped) {
    if (e.type === "eval" && Object.keys(e.scores).every((k) => e.scores[k as keyof typeof e.scores] == null)) {
      emptyScores++;
    }
  }

  const jsonl = deduped.map((e) => JSON.stringify(e)).join("\n") + "\n";
  fs.writeFileSync(OUTPUT_PATH, jsonl, "utf-8");

  console.log(`\n✅ 出力: ${OUTPUT_PATH}`);
  console.log(`   総エントリ: ${deduped.length} (dedup前: ${allEntries.length})`);
  console.log(`   eval: ${deduped.filter((e) => e.type === "eval").length}`);
  console.log(`   image: ${deduped.filter((e) => e.type === "image").length}`);
  if (emptyScores > 0) {
    console.warn(`   ⚠ scores 空の eval エントリ: ${emptyScores}`);
  }

  // AI即分析デモ: characterConsistency 平均をモデル別に集計
  console.log("\n── characterConsistency 平均 (モデル別・eval のみ) ──");
  const byModel: Record<string, number[]> = {};
  for (const e of deduped) {
    if (e.type !== "eval") continue;
    const cc = e.scores.characterConsistency;
    if (cc == null) continue;
    // モデルはノートから抽出 or ソースから推定
    const modelMatch = e.notes.match(/model:(\S+)/);
    const model = modelMatch ? modelMatch[1] : e.source.includes("ab-") ? path.basename(e.source, ".json").replace(/^ab-|-scored$/, "") : "manifest";
    (byModel[model] ??= []).push(cc);
  }
  for (const [model, vals] of Object.entries(byModel).sort()) {
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    console.log(`  ${model.padEnd(40)} avg=${avg.toFixed(1)} (n=${vals.length})`);
  }
}

main();
