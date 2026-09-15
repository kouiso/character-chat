import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// 局長 2026-08-17「本人のセリフなのか、描写の説明なのかわかるようにした方がいい」。
// 差が「18px か 15.5px か」だけやと、読みながらどこからが本人の言葉か分からん。
//
// 名前を貼る形は採らん。モデルは <dialogue> へ地の文を入れる方にも同じだけ雑で
// （記録した通しで、括弧の無い dialogue 行の 67% が地の文やった）、名前を貼ると
// 「これは本人の発言」と言い切ってしまう。器の形で示す方は、何も言い切らん。
//
// 台詞だけが左罫線を持ち、内側へ寄り、わずかに明るい帯を敷く。罫線は inner（心の声）と
// 同じ語彙で、色と太さで層を分ける（inner は 1px の茶、台詞は 2px の accent）。

const readSource = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

const layerBlock = (source: string, layer: string): string => {
  const start = source.indexOf(`  ${layer}: {`);
  if (start < 0) return "";
  return source.slice(start, source.indexOf("\n  },", start));
};

describe("台詞と地の文を器の形で分ける", () => {
  const source = readSource("src/component/ouse/her-message.tsx");
  const dialogue = layerBlock(source, "dialogue");
  const action = layerBlock(source, "action");

  it("台詞は左罫線と字下げを持つ", () => {
    expect(dialogue).toContain("borderLeft");
    expect(dialogue).toContain("paddingLeft");
  });

  it("地の文は罫線を持たん", () => {
    expect(action).not.toContain("borderLeft");
    expect(action).not.toContain("paddingLeft");
  });

  it("台詞と心の声の罫線を取り違えとらん", () => {
    const inner = layerBlock(source, "inner");
    expect(inner).toContain("1px solid");
    expect(dialogue).toContain("2px solid");
  });

  // 大きさの落差は残す。器だけにすると、器を持たん地の文が本文の主役に見える。
  it("台詞の方が大きい", () => {
    const size = (block: string): number =>
      Number(/fontSize:\s*([\d.]+)/u.exec(block)?.[1] ?? Number.NaN);
    expect(size(dialogue)).toBeGreaterThan(size(action));
  });

  // 名前を貼る形へ戻すなら、タグの中身から台詞と地の文を見分けられる根拠が要る。
  it("台詞の器へキャラ名を貼っとらん", () => {
    expect(dialogue).not.toContain("characterName");
    expect(dialogue).not.toContain("character?.name");
  });
});
