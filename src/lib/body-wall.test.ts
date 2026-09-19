import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { WALL_RENDERED_LINE_RUN, checkNoBodyWall, longestRenderedLineRun } from "./quality-guard";

const block = (tag: "action" | "dialogue", lines: string[]) =>
  `<response><${tag}>${lines.join("\n")}</${tag}></response>`;

const alternating = [
  "<response>",
  "<action>肩へ手を置く。</action>",
  "<dialogue>「そばにおって」</dialogue>",
  "<action>指先が震える。</action>",
  "<dialogue>「もう少しだけ」</dialogue>",
  "</response>",
].join("\n");

const DOGFOOD_ROOT = ".work/e2e-results/vlong-dogfood";
// 回収済み本文（2026-08-18-*）は gitignore 済みのローカル fixture。無い環境
// （CI・fresh clone）では較正テストを skip する。同名のファイルが置かれても
// ディレクトリだけを evidence とみなす。
const COLLECTED_BODIES_PRESENT =
  existsSync(DOGFOOD_ROOT) &&
  statSync(DOGFOOD_ROOT).isDirectory() &&
  readdirSync(DOGFOOD_ROOT, { withFileTypes: true }).some(
    (entry) => entry.isDirectory() && entry.name.startsWith("2026-08-18-"),
  );

describe("checkNoBodyWall", () => {
  it("1 行の台詞は壁やない", () => {
    expect(checkNoBodyWall(block("dialogue", ["「そばにおって」"]))).toBe(true);
  });

  it("交互に置かれとる本文は通る", () => {
    expect(checkNoBodyWall(alternating)).toBe(true);
  });

  it("台詞が閾値ぶん続いたら落ちる", () => {
    const lines = Array.from({ length: WALL_RENDERED_LINE_RUN }, (_, i) => `「${i}」`);
    expect(checkNoBodyWall(block("dialogue", lines))).toBe(false);
  });

  // これまでの検出器は dialogue しか見とらんかった。実測 264 ターンの壁 43 件のうち
  // 24 件が action 側で、production では 1 件も見えとらんかった。
  it("地の文が閾値ぶん続いても落ちる", () => {
    const lines = Array.from({ length: WALL_RENDERED_LINE_RUN }, (_, i) => `${i} 行目の描写。`);
    expect(checkNoBodyWall(block("action", lines))).toBe(false);
  });

  it("隣り合う同種ブロックは 1 続きとして数える", () => {
    const half = Math.ceil(WALL_RENDERED_LINE_RUN / 2);
    const lines = Array.from({ length: half }, (_, i) => `${i} 行目。`);
    const twoBlocks = `<response>${block("action", lines).slice(10, -11)}${block("action", lines).slice(10, -11)}</response>`;
    expect(longestRenderedLineRun(twoBlocks).run).toBe(half * 2);
    expect(checkNoBodyWall(twoBlocks)).toBe(false);
  });

  it("空行は行として数えん", () => {
    expect(checkNoBodyWall(block("dialogue", ["「あ」", "", "  ", "「い」"]))).toBe(true);
  });

  // 較正は「何件落ちるか」やのうて「閾値をずらしても同じ集合が落ちるか」で見る。
  // 回収済み本文は測定のたびに増えるので、絶対件数を書くとアームを回すだけでテストが
  // 落ちる。実測の分布は最長連続が 1〜2 に固まっとって、そこから 5 以上へ飛ぶ。
  // 谷が広いので閾値 3 でも 6 でも拾う集合は一致する。一致せんくなったら分布が
  // 変わったということなので、その時は閾値を選び直す。
  // vlong-dogfood の 2026-08-18 実測コーパスは gitignore 済みのローカル fixture。
  // 無い環境(新規 clone・CI)では skip する。owner 側の dc751cc と同じ扱い。
  const corpusRoot = ".work/e2e-results/vlong-dogfood";
  const corpusPresent =
    existsSync(corpusRoot) && readdirSync(corpusRoot).some((dir) => dir.startsWith("2026-08-18-"));

  it.skipIf(!corpusPresent)(
    "回収済みの本文では、閾値 3 と 6 がほぼ同じ集合を拾う（谷が広い）",
    () => {
      const root = corpusRoot;
      let total = 0;
      const atThree: string[] = [];
      const atSix: string[] = [];
      const runs: number[] = [];
      for (const dir of readdirSync(root)) {
        if (!dir.startsWith("2026-08-18-")) continue;
        for (const file of readdirSync(`${root}/${dir}`)) {
          if (!file.endsWith(".txt")) continue;
          const text = readFileSync(`${root}/${dir}/${file}`, "utf8")
            .split("\n")
            .filter((line) => !line.startsWith("# "))
            .join("\n")
            .trim();
          if (!text.includes("<dialogue>")) continue;
          total += 1;
          const { run } = longestRenderedLineRun(text);
          runs.push(run);
          if (run >= 3) atThree.push(`${dir}/${file}`);
          if (run >= WALL_RENDERED_LINE_RUN) atSix.push(`${dir}/${file}`);
        }
      }
      expect(total).toBeGreaterThan(250);
      // 谷は完全な空やのうて、5 行の 1 件だけが挟まっとる。閾値をどこに置いても
      // 拾う集合がほぼ動かんことだけ担保する（全体の 2% 以内）。
      expect(atThree).toEqual(expect.arrayContaining(atSix));
      expect(atThree.length - atSix.length).toBeLessThanOrEqual(Math.ceil(total * 0.02));
      // 壁が全体の何割かも見とく。1 割を切ったら検出器が眠っとるし、
      // 4 割を超えたら閾値が厳し過ぎて撮り直しが増え過ぎる。
      const rate = atSix.length / total;
      expect(rate).toBeGreaterThan(0.05);
      expect(rate).toBeLessThan(0.4);
      // 大半のターンは壁を作っとらん、が前提。ここが崩れたら閾値の議論やのうて
      // 生成側の退行を疑う。
      expect(runs.filter((run) => run <= 2).length / total).toBeGreaterThan(0.6);
    },
  );
});
