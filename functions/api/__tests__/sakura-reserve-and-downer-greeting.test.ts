// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { DatabaseSync } from "node:sqlite";

// 局長の報告（2026-08-19）:
//   #1487「sakura が元々セックスが好きみたいなプロフィールに見えるのでもっと清楚さを出して」
//   #1486「あんた誰って言ってるけどもう家だよね？家連れてきた人にあんた誰とは言わなく無い？」
//
// プロフィール画面に出るのはシートの【キャラクター】ブロック（parseSystemPrompt().personality）。
// 献身はさくらの芯なので消さん。**まだ起きてへんこと**として書き直す。
// 落差が燃料やのに、その燃料を紹介文で先に使い切っとった。

const ROOT = path.resolve(__dirname, "../../..");
const migration = readFileSync(
  path.join(ROOT, "drizzle/0073_sakura_reserve_and_downer_greeting.sql"),
  "utf8",
);

let DatabaseSyncCtor: typeof DatabaseSync | undefined;
try {
  const mod = await import("node:sqlite");
  DatabaseSyncCtor = mod.DatabaseSync;
} catch (error) {
  console.warn("node:sqlite unavailable; migration tests will be skipped", error);
}

const SAKURA_BEFORE = [
  "【キャラクター】",
  "名前: 桜庭さくら",
  "20歳の文学部女子大生、桜庭さくら。清楚で内気だが、本心では誰かを激しく愛したい。恋愛経験は少なく、好きになると全部を捧げてしまう。一人称「わたし」、あなたへは「あなた」。",
  "",
  "【追加設定】",
  "口調：「あの…初めまして。桜庭さくらです。」「…あなたになら、全部、あげたいんです。」「わたし、こんなに誰かを近くに感じたの、初めてです。」服は白かクリーム色のニット。",
].join("\n");

const DOWNER_GREETING_BEFORE = "…あんた、誰？まぁいい。雨宿りしな。タオルはそこ。勝手に使って。";

type Row = { id: string; greeting: string; system_prompt: string };

const migrate = (rows: Row[]): Row[] => {
  if (!DatabaseSyncCtor) throw new Error("node:sqlite is not available");
  const database = new DatabaseSyncCtor(":memory:");
  database.exec(
    "CREATE TABLE character (id TEXT PRIMARY KEY, greeting TEXT NOT NULL, system_prompt TEXT NOT NULL)",
  );
  const insert = database.prepare(
    "INSERT INTO character (id, greeting, system_prompt) VALUES (?, ?, ?)",
  );
  for (const row of rows) insert.run(row.id, row.greeting, row.system_prompt);
  database.exec(migration);
  const out = database
    .prepare("SELECT id, greeting, system_prompt FROM character ORDER BY id")
    .all();
  database.close();
  return out as Row[];
};

const sakura = (systemPrompt = SAKURA_BEFORE): Row => ({
  id: "char-koharu-ex",
  greeting: "え…？ あの…わたし、ですか？",
  system_prompt: systemPrompt,
});

const downer = (greeting = DOWNER_GREETING_BEFORE): Row => ({
  id: "import-charap-ダウナーお姉さんに拾われる話",
  greeting,
  system_prompt: "【キャラクター】\n名前: 霜月鈴",
});

describe.skipIf(!DatabaseSyncCtor)("0073", () => {
  it("さくらの紹介文から、まだ起きてへんことを断定する一文が消える", () => {
    const [row] = migrate([sakura()]);

    expect(row.system_prompt).not.toContain("本心では誰かを激しく愛したい");
    expect(row.system_prompt).not.toContain("好きになると全部を捧げてしまう");
    expect(row.system_prompt).toContain("崩れた自分を誰にも見せたことがない");
    // 献身はこの子の芯。消すんやのうて、条件付きへ移す。
    expect(row.system_prompt).toContain("心を許した相手にだけ");
  });

  it("さくらの口調の見本が、落ちた後の台詞やのうて初対面のものになる", () => {
    const [row] = migrate([sakura()]);

    expect(row.system_prompt).not.toContain("あなたになら、全部、あげたいんです");
    expect(row.system_prompt).toContain("こういうの、慣れてなくて");
    // 名乗りは初対面の register なので残す。
    expect(row.system_prompt).toContain("初めまして。桜庭さくらです。");
  });

  it("ダウナーの第一声が、家へ上げた後の場面と噛み合う", () => {
    const [row] = migrate([downer()]);

    expect(row.greeting).not.toContain("あんた、誰？");
    // シートの address は「きみ」。greeting だけ「あんた」で食い違っとった。
    expect(row.greeting).toContain("きみ");
    expect(row.greeting).toContain("タオル");
  });

  it("既に書き換わっとる行へ再適用しても変わらん", () => {
    const once = migrate([sakura(), downer()]);
    const twice = migrate(once);

    expect(twice).toEqual(once);
  });

  it("別のキャラの行には触らん", () => {
    const other: Row = {
      id: "other",
      greeting: DOWNER_GREETING_BEFORE,
      system_prompt: SAKURA_BEFORE,
    };

    expect(migrate([other])).toEqual([other]);
  });
});
