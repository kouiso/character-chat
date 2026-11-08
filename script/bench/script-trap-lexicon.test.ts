import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { BENCH_SCRIPTS } from "./scripts";

// RIT-6: 台本の「あなた」発言が src/lib/scene-phase.ts の disengagement /
// ambiguous-climax cue の部分文字列を偶然含むと phase 検出が壊れる。
// 実害例（2026-09-17）: 「受け止めて」の「止め」で連続リセット、
// 「手、出して」の「出して」で絶頂早撃ち、「受け入れてる」の「入れ」で erotic 誤昇格。
// script-phase-arc.test.ts がアーク全体を守るのに対し、ここでは罠語彙そのものを
// 包含検査して、台本改訂で事故を仕込まんための門にする。
//
// cue の定義元:
// - disengagement: scene-phase.ts の PROACTIVE_BLOCK_CUES 冒頭（場面を降ろす離脱語）
// - ambiguous-climax: AMBIGUOUS_CLIMAX_CUES（matchesAmbiguousClimaxCue が拾う語）
const DISENGAGEMENT_TRAPS = [
  "やめ",
  "止め",
  "待って",
  "無理",
  "いや",
  "嫌",
  "離れ",
  "今日はここまで",
] as const;

const AMBIGUOUS_CLIMAX_TRAPS = ["いく", "出して", "果て"] as const;

// 意図的に踏んでいる行の免除。キーは台本の user 行の全文、値は理由。
// 免除は「この語を踏むことがその腕の測定内容そのもの」の場合だけ使う。
const ALLOWED = new Map<string, string>([
  [
    "やめてって言ってるのに、なんで笑うの",
    "nonconsent 腕（エレベータ閉じ込め）では「あなた」側の抵抗そのものが測定対象",
  ],
  [
    "……嫌なのに、どうして体が……",
    "nonconsent 腕同上。拒絶しつつ体が反応する段の台詞で、罠語彙を踏むのが中身",
  ],
]);

const root = path.resolve(import.meta.dirname, "..", "..");

type ScriptLine = { source: string; user: string };

// 元ファイルはテキストとして読む。import すると実行時副作用（dogfood 実行や
// D1 接続）が走るので、scripts.test.ts と同じく `user: "..."` を正規表現で拾う。
const userLinesFromFile = (rel: string): ScriptLine[] => {
  const text = readFileSync(path.join(root, rel), "utf-8");
  const lines: ScriptLine[] = [];
  const re = /user:\s*"((?:[^"\\]|\\.)*)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    lines.push({ source: `${rel}`, user: match[1] });
  }
  return lines;
};

const allScriptLines = (): ScriptLine[] => [
  // script/bench/scripts.ts（BENCH_SCRIPTS）
  ...Object.values(BENCH_SCRIPTS).flatMap((script) =>
    script.map((turn) => ({ source: "script/bench/scripts.ts", user: turn.user })),
  ),
  // packages/bench/src/script-run.ts（adult/nonadult/nonconsent/extreme/sakura-nc/sakura-fix）
  ...userLinesFromFile("packages/bench/src/script-run.ts"),
  // 写しの元（vlong-dogfood の SCRIPTS）
  ...userLinesFromFile("script/verify/vlong-session-dogfood.ts"),
];

const findTrapHits = (user: string): string[] =>
  [...DISENGAGEMENT_TRAPS, ...AMBIGUOUS_CLIMAX_TRAPS].filter((trap) => user.includes(trap));

describe("台本の user 行は phase 罠語彙を踏まない", () => {
  const lines = allScriptLines();

  it("走査対象が取れている（0件は比較が成立せん）", () => {
    expect(lines.length).toBeGreaterThan(50);
  });

  it("disengagement / ambiguous-climax の部分文字列を含む行は allowlist 以外無い", () => {
    const violations = lines
      .filter((line) => !ALLOWED.has(line.user))
      .flatMap((line) =>
        findTrapHits(line.user).map(
          (trap) => `${line.source}: ${line.user.slice(0, 40)}…（罠語彙: ${trap}）`,
        ),
      );
    expect(violations).toStrictEqual([]);
  });

  it("allowlist の各行は実際に台本に存在する（古い免除を残さん）", () => {
    const users = new Set(lines.map((line) => line.user));
    for (const allowed of ALLOWED.keys()) {
      expect(users.has(allowed)).toBe(true);
    }
  });
});
