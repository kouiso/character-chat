/**
 * quality-gate-firing.ts — 回収済みの通し読みダンプへ runQualityChecks を掛け直して、
 * 「どの検出器が 1 回きりの再試行を食うか」と「後ろの検出器が何回食われとるか」を数える。
 *
 * API 課金はゼロ。PBI-D の完了条件（各検出器の発火表）に当たる。
 *
 * #1470 以前は runQualityChecks が最初に落ちた 1 個で打ち切っとったため、列の後ろの
 * 検出器は前のどれかが先に落ちた時点で「発火はするが直させる機会が無い」状態になった。
 * 今は落ちたものを全部 1 回の撮り直しへ渡すので、この表は masked の実数やのうて
 * 「先頭に立つ検出器の分布」を見るために使う。
 *
 * 使い方: pnpm exec tsx script/verify/quality-gate-firing.ts [dump-root]
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { checkRepeatedVocativeLead, runQualityChecks } from "../../src/lib/quality-guard";
import type { ScenePhase } from "../../src/lib/scene-phase";

const HEADER_END = "# error: -\n";
const DEFAULT_ROOT = ".work/e2e-results/vlong-dogfood";
const KNOWN_PHASES = new Set<ScenePhase>([
  "conversation",
  "intimate",
  "erotic",
  "climax",
  "afterglow",
]);

type Turn = { character: string; index: number; phase: ScenePhase; body: string };

const toPhase = (raw: string): ScenePhase =>
  KNOWN_PHASES.has(raw as ScenePhase) ? (raw as ScenePhase) : "conversation";

const parseTurn = (dir: string, file: string): Turn | null => {
  const raw = readFileSync(resolve(dir, file), "utf8");
  const [header, body] = raw.split(HEADER_END);
  if (body === undefined) return null;
  const field = (name: string) => header.match(new RegExp(`# ${name}: (.+)`))?.[1]?.trim() ?? "";
  return {
    character: field("character"),
    index: Number(field("turn")),
    phase: toPhase(field("servedPhase")),
    body,
  };
};

const loadArm = (dir: string): Turn[] =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".txt"))
    .map((f) => parseTurn(dir, f))
    .filter((t): t is Turn => t !== null)
    .sort((a, b) => a.character.localeCompare(b.character) || a.index - b.index);

const root = resolve(process.argv[2] ?? DEFAULT_ROOT);
const arms = readdirSync(root).filter((d) => statSync(resolve(root, d)).isDirectory());

const firstFailure = new Map<string, number>();
let turns = 0;
let passed = 0;
let vocativeWouldFire = 0;
let vocativeMasked = 0;
const maskedBy = new Map<string, number>();
const perArm: { arm: string; turns: number; failed: number; repetition: number }[] = [];

for (const arm of arms) {
  const all = loadArm(resolve(root, arm));
  const byCharacter = new Map<string, Turn[]>();
  const armStat = { arm, turns: 0, failed: 0, repetition: 0 };
  perArm.push(armStat);
  for (const turn of all) {
    const prev = byCharacter.get(turn.character) ?? [];
    turns += 1;

    const result = runQualityChecks(turn.body, {
      phase: turn.phase,
      characterName: turn.character,
      prevAssistantResponse: prev.at(-1)?.body,
      prevAssistantResponses: prev.map((p) => p.body),
    });

    armStat.turns += 1;
    if (result.passed) passed += 1;
    else {
      armStat.failed += 1;
      const check = result.failedCheck ?? "?";
      if (check.includes("repetition") || check === "near-duplicate-response") armStat.repetition += 1;
      firstFailure.set(check, (firstFailure.get(check) ?? 0) + 1);
    }

    // 列の 23 番目。単独で掛けたら落ちるのに、前段が先に落ちたせいで直させる機会が無いターンを数える。
    if (!checkRepeatedVocativeLead(turn.body)) {
      vocativeWouldFire += 1;
      if (!result.passed && result.failedCheck !== "within-turn-vocative-lead") {
        vocativeMasked += 1;
        maskedBy.set(result.failedCheck ?? "?", (maskedBy.get(result.failedCheck ?? "?") ?? 0) + 1);
      }
    }

    prev.push(turn);
    byCharacter.set(turn.character, prev);
  }
}

const rows = [...firstFailure.entries()].sort((a, b) => b[1] - a[1]);
console.log(`arms: ${arms.length}  turns: ${turns}  passed: ${passed}  failed: ${turns - passed}`);
console.log("\n再試行を食う検出器（runQualityChecks が最初に返した failedCheck）");
for (const [check, count] of rows) {
  console.log(`  ${String(count).padStart(4)}  ${check}`);
}
console.log(
  `\nwithin-turn-vocative-lead（列の 23/26 番目）: 単独発火 ${vocativeWouldFire} / うち前段に食われた ${vocativeMasked}`,
);
for (const [check, count] of [...maskedBy.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(4)}  ${check} が先に落ちた`);
}

console.log("\nアーム別（新しい順に並べ替えはせん。ディレクトリ名が日付つき）");
for (const a of perArm.sort((x, y) => x.arm.localeCompare(y.arm))) {
  const rate = a.turns ? Math.round((a.failed / a.turns) * 100) : 0;
  console.log(
    `  ${a.arm.padEnd(24)} ${String(a.turns).padStart(3)}t  失敗 ${String(a.failed).padStart(3)} (${String(rate).padStart(3)}%)  うち反復 ${a.repetition}`,
  );
}
