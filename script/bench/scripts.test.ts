import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { BENCH_SCRIPTS } from "./scripts";

// 元ファイルは import せずテキストとして読む。import するとドッグフード実行が走る
// （script/verify/vlong-session-dogfood.ts:542 が main() をトップレベルで呼ぶ）。
const SOURCE = readFileSync(
  path.resolve(import.meta.dirname, "..", "verify", "vlong-session-dogfood.ts"),
  "utf-8",
);

/**
 * 元ファイルの SCRIPTS ブロックから `{ intent, user }` を**順番どおり**取り出す。
 *
 * 「各発話が元ファイルのどこかに在る」だけの片方向の確認では、元が並べ替えられても、
 * intent が変わっても、11ターン目が足されても緑のまま通る。生成条件は記録済み条件と
 * ターン番号と intent で突き合わせるので、そのズレは比較を静かに壊す。
 */
const parseSourceScripts = (): Record<string, { intent: string; user: string }[]> => {
  const block = /const SCRIPTS: Record<CharacterKey, ScriptedTurn\[\]> = \{([\s\S]*?)\n\};/.exec(
    SOURCE,
  );
  if (!block) throw new Error("元ファイルの SCRIPTS ブロックが見つからん");
  const parsed: Record<string, { intent: string; user: string }[]> = {};
  // フォーマッタが1行オブジェクトを複数行へ展開しても拾えるよう、
  // キー行と { intent, user } オブジェクトは行単位でなくブロック全体から順に取る。
  const entry =
    /^\s{2}(\w+):\s*\[|\{\s*intent:\s*"(\w+)",\s*user:\s*"((?:[^"\\]|\\.)*)"\s*,?\s*\}/gm;
  let current: string | null = null;
  for (const m of block[1].matchAll(entry)) {
    if (m[1]) {
      current = m[1];
      parsed[current] = [];
      continue;
    }
    if (current) parsed[current].push({ intent: m[2], user: m[3] });
  }
  return parsed;
};

describe("BENCH_SCRIPTS は vlong-dogfood の台本の写し", () => {
  const source = parseSourceScripts();

  it("元ファイルから台本を読み出せる（読めんかったら比較が成立せん）", () => {
    expect(Object.keys(source).sort()).toStrictEqual(["downer", "sakura"]);
    for (const script of Object.values(source)) expect(script.length).toBeGreaterThan(0);
  });

  it("キャラの並びまで一致する", () => {
    expect(Object.keys(BENCH_SCRIPTS).sort()).toStrictEqual(Object.keys(source).sort());
  });

  it("intent と発話が順番どおり一致する（並べ替え・intent 変更・ターン追加で落ちる）", () => {
    for (const [key, script] of Object.entries(BENCH_SCRIPTS)) {
      expect(script.map((turn) => ({ intent: turn.intent, user: turn.user }))).toStrictEqual(
        source[key],
      );
    }
  });
});
