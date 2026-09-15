// @vitest-environment node
// node:sqlite は jsdom 環境ではバンドルできん。character-fixture.test.ts と同じ扱い。
import { describe, expect, it } from "vitest";

import { forbiddenWordCheck } from "../../packages/judge/src/forbidden-word-check";
import { kanaReading } from "../../packages/judge/src/normalize-text";
import { buildCharacterTable, parseForbiddenWords } from "./character-fixture";

// 禁止語を仮名で書き直して逃げる穴（refute-r2 2026-09-14 #1: シートが「快感」でも
// 本文が「カイカン」なら素通り）を、実データの語彙そのもので固定する。
// normalize-text.ts の読み表がリポジトリ中の全シートの forbidden_words を仮名へ引けること、
// かつ引いた仮名で書かれた本文が実際に落ちることを確かめる。新しいシートが表に無い漢字語を
// 足したら、ここが落ちて表を伸ばす合図になる。
const collectForbiddenWords = (): Map<string, string> => {
  const db = buildCharacterTable();
  const rows = db.prepare("SELECT name, system_prompt AS systemPrompt FROM character").all() as {
    name: string;
    systemPrompt: string;
  }[];
  db.close();
  const words = new Map<string, string>();
  for (const row of rows) {
    for (const word of parseForbiddenWords(row.systemPrompt)) {
      if (!words.has(word)) words.set(word, row.name);
    }
  }
  return words;
};

describe("forbidden_words の読み", () => {
  const forbiddenWords = collectForbiddenWords();

  it("リポジトリ中のシートから禁止語を集められる", () => {
    expect(forbiddenWords.size).toBeGreaterThan(10);
  });

  it("全ての禁止語に仮名の読みが引ける", () => {
    const missing = [...forbiddenWords.keys()].filter((word) => kanaReading(word) === undefined);
    expect(missing, "normalize-text.ts の READING_VARIANTS へ足すこと").toEqual([]);
  });

  it("仮名で書き直した禁止語も落とす", () => {
    const escaped: string[] = [];
    for (const [word, character] of forbiddenWords) {
      const reading = kanaReading(word);
      if (reading === undefined || reading === word) continue;
      const sheet = `【キャラカード】\nforbidden_words: ${word}\n`;
      if (forbiddenWordCheck(`<dialogue>${reading}</dialogue>`, sheet).ok) {
        escaped.push(`${word}→${reading} (${character})`);
      }
    }
    expect(escaped).toEqual([]);
  });

  it("シートに無い語は仮名で書かれても落とさん", () => {
    const sheet = "【キャラカード】\nforbidden_words: 快感\n";
    expect(forbiddenWordCheck("<dialogue>はいとく</dialogue>", sheet).ok).toBe(true);
  });
});
