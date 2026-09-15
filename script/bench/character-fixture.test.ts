// @vitest-environment node
// node:sqlite は jsdom 環境ではバンドルできん。conversations-routes.test.ts と同じ扱い。
import { describe, expect, it } from "vitest";

import {
  buildCharacterTable,
  DOGFOOD_CHARACTER_IDS,
  loadCharacter,
  parseForbiddenWords,
} from "./character-fixture";

// 実際のシートに必要な禁止語（局長口述: さくらは「気持ちいい」「快感」を言わせん）。
// この配列を判定基準にするのやのうて、seed.ts / migrations 側の forbidden_words 行を
// parseForbiddenWords で読んで、この2語が実際に載っとるかを確かめる側に使う。
const SAKURA_REQUIRED_FORBIDDEN_WORDS = ["気持ちいい", "快感"] as const;

// node:sqlite は --experimental-sqlite が要る。package.json の test スクリプトが渡しとる。
describe("character-fixture", () => {
  it("vlong-dogfood の2体を D1 もサーバも無しで組み立てられる", () => {
    for (const id of Object.values(DOGFOOD_CHARACTER_IDS)) {
      const character = loadCharacter(id);
      expect(character.systemPrompt.length).toBeGreaterThan(500);
      expect(character.greeting.length).toBeGreaterThan(0);
    }
  });

  it("migration の更新が効いとる（seed の文字列をそのまま返しとらん）", () => {
    // drizzle/0068_sakura_ending_overuse.sql までを適用した後の姿を見とる。
    const sakura = loadCharacter(DOGFOOD_CHARACTER_IDS.sakura);
    expect(sakura.name).toBe("桜庭 さくら");
    expect(sakura.systemPrompt).toContain("快感");
  });

  it("さくらの forbidden_words に「気持ちいい」「快感」が両方載っとる（seed / migrations 両経路）", () => {
    // CI88実測(2026-09-06): forbidden_words にこの2語を持つはずのキャラが、
    // シートの本文中に別文脈で同じ語が出るだけで .toContain() が偽陽性合格しかねん。
    // forbidden_words 行そのものを parseForbiddenWords で読み、配列の要素として確かめる。
    // seed.ts の行が抜けたら（migrations 側の 0065 の上書きが効いとる間も）ここが落ちる。
    for (const source of ["seed", "migrations"] as const) {
      const sakura = loadCharacter(DOGFOOD_CHARACTER_IDS.sakura, source);
      const forbiddenWords = parseForbiddenWords(sakura.systemPrompt);
      for (const word of SAKURA_REQUIRED_FORBIDDEN_WORDS) {
        expect(forbiddenWords, `source=${source}`).toContain(word);
      }
    }
  });

  it("経路が違えばシートも違う。どっちで組んだかを持ち回る", () => {
    const fromMigrations = loadCharacter(DOGFOOD_CHARACTER_IDS.sakura, "migrations");
    const fromSeed = loadCharacter(DOGFOOD_CHARACTER_IDS.sakura, "seed");
    expect(fromMigrations.source).toBe("migrations");
    expect(fromSeed.source).toBe("seed");
    // 一致しとらんことを固定しとく。「本番と同じ」と言えん理由がこれ
    expect(fromMigrations.systemPrompt).not.toBe(fromSeed.systemPrompt);
  });

  it("seed.ts に行が無いキャラは seed 経路で落とす（Downer は migration 由来）", () => {
    expect(() => loadCharacter(DOGFOOD_CHARACTER_IDS.downer, "seed")).toThrow(/seed\.ts/);
  });

  it("知らん id は落とす（黙って空のシートで生成せん）", () => {
    expect(() => loadCharacter("char-does-not-exist")).toThrow(/見つからん/);
  });

  it("character 表は migration を全部適用した形で建つ", () => {
    const db = buildCharacterTable();
    const count = db.prepare("SELECT COUNT(*) AS n FROM character").get() as { n: number };
    db.close();
    expect(count.n).toBeGreaterThan(50);
  });
});
