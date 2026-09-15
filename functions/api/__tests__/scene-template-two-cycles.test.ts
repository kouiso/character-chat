// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { SCENE_RESPONSE_STRUCTURE } from "../../../src/lib/prompt-variant-defaults";

import type { DatabaseSync } from "node:sqlite";

// 実測（phase36・20 ターン）: erotic と climax だけ <action> が 1 個へ潰れて、
// 画面上 8〜13 行の地の文の壁になる。conversation / intimate / afterglow は同じ雛形で
// 交互に書けとるので、モデルが書けんわけやない。
//
// 雛形が 2 種類同時に届いとった。user 発言の直前の lengthClosingRule は交互複数組を
// 見せるのに、system 側のこの本文は 1 組だけ。しかも <action> の説明は 7 行で感覚義務つき、
// <dialogue> は 1 行。厚くする義務が付いとる方の雛形が 1 組なら、長さの行き先は action しかない。
//
// 外枠の見本を 2 サイクルへ書き直したら 16 ターン全部が交互になった実績が既にある（台帳 C16）。

const countTag = (text: string, tag: string): number =>
  [...text.matchAll(new RegExp(`^<${tag}>$`, "gm"))].length;

describe("scene の雛形が交互を見せる", () => {
  it("<action> と <dialogue> が 2 組ある", () => {
    expect(countTag(SCENE_RESPONSE_STRUCTURE, "action")).toBeGreaterThanOrEqual(2);
    expect(countTag(SCENE_RESPONSE_STRUCTURE, "dialogue")).toBeGreaterThanOrEqual(2);
  });

  // <inner> は非表示で 1 つの約束。増やすと表示層の数え方が狂う。
  it("<inner> は 1 つだけ", () => {
    expect(countTag(SCENE_RESPONSE_STRUCTURE, "inner")).toBe(1);
  });

  it("積み上げるなという指示が雛形の中に在る", () => {
    expect(SCENE_RESPONSE_STRUCTURE).toContain("交互に繰り返し");
    expect(SCENE_RESPONSE_STRUCTURE).toContain("積み上げん");
  });
});

// 定数を直しても、実際に配られるのは D1 の prompt_variant 行。
const ROOT = path.resolve(__dirname, "../../..");
const migration = readFileSync(
  path.join(ROOT, "drizzle/0071_two_cycle_template_in_prompt_variant.sql"),
  "utf8",
);

let DatabaseSyncCtor: typeof DatabaseSync | undefined;
try {
  const mod = await import("node:sqlite");
  DatabaseSyncCtor = mod.DatabaseSync;
} catch (error) {
  // この Node ビルドでは node:sqlite が無効。下の describe が skipIf で外れるので、
  // 黙って 0 件になったのか環境の都合なのかが後から分かるように残す。
  console.warn("node:sqlite unavailable; migration tests will be skipped", error);
}

const migrate = (...bodies: string[]): string[] => {
  if (!DatabaseSyncCtor) throw new Error("node:sqlite is not available");
  const database = new DatabaseSyncCtor(":memory:");
  database.exec("CREATE TABLE prompt_variant (id TEXT PRIMARY KEY, body TEXT NOT NULL)");
  const insert = database.prepare("INSERT INTO prompt_variant (id, body) VALUES (?, ?)");
  bodies.forEach((body, index) => insert.run(`variant-${index}`, body));
  database.exec(migration);
  const rows = database.prepare("SELECT body FROM prompt_variant ORDER BY id").all() as {
    body: string;
  }[];
  database.close();
  return rows.map((row) => row.body);
};

const ONE_CYCLE = `<dialogue>
「セリフ」をここに。必ず日本語の鉤括弧「」で囲む。キャラの口調・語尾を厳守。
</dialogue>
<action>
場面が進んだぶんをここに書く。<action>と<dialogue>は必要なだけ交互に繰り返し、1つのタグへ段落を積み上げん。
</action>
<dialogue>
続きのセリフ。
</dialogue>
<inner>
キャラの内心、本音、葛藤。口に出さない感情。<inner>は最後に1つだけ。
</inner>
</response>`;

describe.skipIf(!DatabaseSyncCtor)("0071 は D1 の champion を定数と同じ本文へ揃える", () => {
  it("scene_response_structure", () => {
    const before = SCENE_RESPONSE_STRUCTURE.replace(
      ONE_CYCLE,
      `<dialogue>
「セリフ」をここに。必ず日本語の鉤括弧「」で囲む。キャラの口調・語尾を厳守。
</dialogue>
<inner>
キャラの内心、本音、葛藤。口に出さない感情。
</inner>
</response>`,
    );
    expect(before).not.toBe(SCENE_RESPONSE_STRUCTURE);

    expect(migrate(before)).toEqual([SCENE_RESPONSE_STRUCTURE]);
  });

  // migration は既に当たった行へも走りうる。二度目で何も変わらんこと。
  it("既に 2 サイクルの行へ再適用しても変わらん", () => {
    expect(migrate(SCENE_RESPONSE_STRUCTURE)).toEqual([SCENE_RESPONSE_STRUCTURE]);
  });
});
