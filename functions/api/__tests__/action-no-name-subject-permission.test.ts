// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  PLATFORM_BASE_SCENE,
  SCENE_RESPONSE_STRUCTURE,
} from "../../../src/lib/prompt-variant-defaults";
import { QUALITY_RETRY_HINTS } from "../lib/route-context";

import type { DatabaseSync } from "node:sqlite";

// 地の文（<action>）が三人称の小説調になる件。
//
// 相反する 2 つの指示が同時に届いとった。scene_response_structure が
//   キャラ名主語、主語省略、一人称体感のいずれも可。
// と許可する一方で、few-shot 見本 3 本は同じ書き方を
//   (third-person narration — BANNED)
// と示し、quality-guard の checkNoThirdPersonNarration がキャラ名主語 2 個以上で撮り直させる。
// 撮り直しは 1 回 30〜40 秒。しかも本体プロンプトからは同じ許可が届き続けるので戻る。
//
// 指示を足しても勝たん。勝っとる側の許可を削る。

const PERMISSION = "キャラ名主語、主語省略、一人称体感のいずれも可。";
const KEPT = "主語は省き、キャラ自身の体感として書く。";

describe("<action> の人称は許可と禁止が食い違わん", () => {
  it("キャラ名主語の許可が消えとる", () => {
    expect(SCENE_RESPONSE_STRUCTURE).not.toContain(PERMISSION);
  });

  // 実測（各 20 ターン）で、壁を割るほど段落の書き出しの反復が増えた（同一書出 4 → 7）。
  // 「いずれも可」は選ばんでもええと読めるので、断定へ寄せて曖昧さを削る。
  it("主語を省くことが選択肢やのうて指示になっとる", () => {
    expect(SCENE_RESPONSE_STRUCTURE).toContain(KEPT);
  });

  // 撮り直しのヒントが汎用文言だけやと、モデルは何で落ちたか分からんまま同じ形を返す。
  it("三人称で落ちた時に何を直すかが撮り直しへ届く", () => {
    const hint = QUALITY_RETRY_HINTS["third-person-narration"];
    expect(hint).toBeTruthy();
    expect(hint).toContain("彼女");
  });
});

// 定数を直しても、実際に配られるのは D1 の prompt_variant 行。
const ROOT = path.resolve(__dirname, "../../..");
// 本番は番号順に当たる。1 本だけ当てて定数と比べると、後の migration が同じ行へ触れた
// 瞬間にテストが嘘になる（0072 で実際に起きた）。順に当てて突き合わせる。
const migrations = [
  "drizzle/0070_drop_name_subject_permission_in_prompt_variant.sql",
  "drizzle/0072_drop_subject_option_in_prompt_variant.sql",
].map((file) => readFileSync(path.join(ROOT, file), "utf8"));

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
  for (const migration of migrations) database.exec(migration);
  const rows = database.prepare("SELECT body FROM prompt_variant ORDER BY id").all() as {
    body: string;
  }[];
  database.close();
  return rows.map((row) => row.body);
};

describe.skipIf(!DatabaseSyncCtor)("0070 と 0072 で D1 の champion が定数と揃う", () => {
  it("scene_response_structure", () => {
    const before = SCENE_RESPONSE_STRUCTURE.replace(KEPT, PERMISSION);
    expect(before).toContain(PERMISSION);
    expect(before).not.toBe(SCENE_RESPONSE_STRUCTURE);

    expect(migrate(before)).toEqual([SCENE_RESPONSE_STRUCTURE]);
  });

  it("許可を持たん行には触らん", () => {
    expect(migrate(PLATFORM_BASE_SCENE)).toEqual([PLATFORM_BASE_SCENE]);
  });

  // migration は既に当たった行へも走りうる。二度目で何も変わらんこと。
  it("既に落ちとる行へ再適用しても変わらん", () => {
    expect(migrate(SCENE_RESPONSE_STRUCTURE)).toEqual([SCENE_RESPONSE_STRUCTURE]);
  });
});
