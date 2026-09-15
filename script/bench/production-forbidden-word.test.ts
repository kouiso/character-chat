// @vitest-environment node
// node:sqlite は jsdom 環境ではバンドルできん。character-fixture.test.ts と同じ扱い。
import { describe, expect, it } from "vitest";

import { forbiddenWordCheck } from "../../packages/judge/src/forbidden-word-check";
import { kanaReading } from "../../packages/judge/src/normalize-text";

import { parseForbiddenWords } from "./character-fixture";
import { loadProductionCharacters, PRODUCTION_EXPORT_PATH } from "./production-sheet";

// forbidden-word-reading.test.ts はリポジトリの fixture（190体）を見とる。本番に実際に
//入っとるのは .work/d1-export/character.sql の 221体で、そっちにしか無い語がある
// （refute-r3 2026-09-14: チャラ男大学生の「焦る」が動詞やのに活用させとらんかった）。
//
// 吸い出したデータは git 管理外なので、無い環境では理由を出して飛ばす。
const characters = loadProductionCharacters();
const forbiddenWords = new Map<string, string>();
for (const character of characters) {
  for (const word of parseForbiddenWords(character.systemPrompt)) {
    if (!forbiddenWords.has(word)) forbiddenWords.set(word, character.name);
  }
}

const describeProduction = characters.length > 0 ? describe : describe.skip;

if (characters.length === 0) {
  console.warn(`本番シートの吸い出しが無いので飛ばす: ${PRODUCTION_EXPORT_PATH}`);
}

describeProduction("本番シートの forbidden_words", () => {
  it("本番の全キャラを読める", () => {
    expect(characters.length).toBeGreaterThan(200);
  });

  // refute-r4 2026-09-14 #5: 本番シートは改行が「\n」の2文字で入っとる物が 221 中 64 あり、
  // 行頭固定のパターンが全部1行として読んでまうので、forbidden_words 行を持つ 67 体のうち
  // 4 体しか読めとらんかった。畳めば 67 体全部読める。
  it("forbidden_words 行を持つシートを全部読める", () => {
    const withLine = characters.filter((character) =>
      character.systemPrompt.includes("forbidden_words:"),
    ).length;
    const parsed = characters.filter(
      (character) => parseForbiddenWords(character.systemPrompt).length > 0,
    ).length;
    expect(withLine).toBeGreaterThanOrEqual(60);
    expect(parsed).toBe(withLine);
  });

  it("どの禁止語も、そのままの形なら必ず落ちる", () => {
    const escaped: string[] = [];
    for (const [word, character] of forbiddenWords) {
      const sheet = `【キャラカード】\nforbidden_words: ${word}\n`;
      if (forbiddenWordCheck(`<dialogue>${word}</dialogue>`, sheet).ok) {
        escaped.push(`${word} (${character})`);
      }
    }
    expect(escaped).toEqual([]);
  });

  // 動詞の活用（refute-r3 2026-09-14 の指摘）。本番シートの「焦る」で実際に確かめる。
  it("動詞の禁止語は活用形でも落ちる", () => {
    const sheet = "【キャラカード】\nforbidden_words: 焦る\n";
    for (const form of ["焦る", "焦って", "焦った", "焦り", "焦らないで", "焦れば"]) {
      const result = forbiddenWordCheck(`<dialogue>${form}ます</dialogue>`, sheet);
      expect(result.ok, `${form} がすり抜けた`).toBe(false);
    }
  });

  it("一段動詞の禁止語も活用形で落ちる", () => {
    const sheet = "【キャラカード】\nforbidden_words: 感じる\n";
    for (const form of ["感じる", "感じて", "感じた", "感じない"]) {
      expect(forbiddenWordCheck(`<dialogue>${form}</dialogue>`, sheet).ok, form).toBe(false);
    }
  });

  // 読みを引けん語は「書かれたままの形」でしか照合でけん。落ちるべき語が落ちんくなる
  // わけやないので失敗にはせんが、どれが対象外かは数えて出す。
  it("仮名の読みを引けん語を数えて出す", () => {
    const withoutReading = [...forbiddenWords.keys()].filter(
      (word) => kanaReading(word) === undefined,
    );
    console.info(
      `本番 ${forbiddenWords.size} 語のうち、読みを引けん語 ${withoutReading.length}: ${withoutReading.join("、")}`,
    );
    expect(withoutReading.length).toBeLessThan(forbiddenWords.size);
  });
});
