// @vitest-environment node
// node:sqlite は jsdom 環境ではバンドルできないため、このファイルだけ node 環境で走らせる。
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

import { selectRelevantMemories } from "../../../src/lib/memory-relevance";
import { fetchRecentMemoryNotes } from "../lib/route-context";

import type { MemoryRelevanceContext } from "../../../src/lib/memory-relevance";
import type { DatabaseSync } from "node:sqlite";

let DatabaseSyncCtor: typeof DatabaseSync | undefined;
try {
  const mod = await import("node:sqlite");
  DatabaseSyncCtor = mod.DatabaseSync;
} catch {
  // この Node ビルドでは node:sqlite が無効化されている。
}

// 候補の絞り込みは D1 の SQL がやる。SQL 文字列を見るモックでは「古い一致ノートが
// LIMIT の窓の外で落ちる」事実を観測でけへんので、実 SQLite エンジンに繋ぐ。
const USER_ID = "sukererion@gmail.com";
const CHARACTER_ID = "char-mio";
const DAY_MS = 1000 * 60 * 60 * 24;
const NOW = 1_800_000_000_000;

// 局長が今まさに書いた turn。ここに出てくる語と噛み合うノートが引けなあかん。
const CURRENT_TURN = "猫カフェ行きたいけど、俺は猫アレルギーやからな";
const OLD_RELEVANT_ID = "note-old-relevant";
// memory extraction が実際に落とすのはこういう一行ファクト（buildMemoryExtractionPrompt 参照）。
const OLD_RELEVANT_CONTENT = "ユーザーは猫アレルギー";
// 話題は噛み合わんが、活用語尾だけが今の turn と重なる古いノート。
const INFLECTION_ONLY_ID = "note-old-inflection";
// 直近20件の窓を確実に埋めるため、無関係ノートを窓より多く積む。
const FILLER_COUNT = 24;

const makeRealD1 = () => {
  if (!DatabaseSyncCtor) {
    throw new Error("node:sqlite is not available");
  }
  const db = new DatabaseSyncCtor(":memory:");
  db.exec(`
    CREATE TABLE memory_note (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, character_id TEXT NOT NULL,
      content TEXT NOT NULL, source_message_id TEXT, created_at INTEGER NOT NULL,
      edited_at INTEGER, last_used_at INTEGER, usage_count INTEGER NOT NULL DEFAULT 0
    );
  `);

  const wrap = (sql: string, args: unknown[]) => {
    const bound = args.map((a) => (a === undefined ? null : a)) as never[];
    const returnsRows = /^\s*select/i.test(sql) || /\breturning\b/i.test(sql);
    let cached: Record<string, unknown>[] | undefined;
    const rows = (): Record<string, unknown>[] => {
      if (cached === undefined) {
        if (returnsRows) {
          cached = db.prepare(sql).all(...bound) as Record<string, unknown>[];
        } else {
          db.prepare(sql).run(...bound);
          cached = [];
        }
      }
      return cached;
    };
    return {
      all: async () => ({ results: rows(), success: true }),
      first: async () => rows()[0] ?? null,
      run: async () => {
        rows();
        return { success: true, meta: {}, results: [] };
      },
      raw: async <T = unknown[]>() => rows().map((r) => Object.values(r)) as T[],
      values: async <T = unknown[]>() => rows().map((r) => Object.values(r)) as T[],
    };
  };

  const d1 = {
    prepare: (sql: string) => ({ bind: (...args: unknown[]) => wrap(sql, args), ...wrap(sql, []) }),
    dump: () => Promise.resolve(new ArrayBuffer(0)),
    batch: () => Promise.resolve([]),
    exec: () => Promise.resolve({ count: 0, duration: 0 }),
  };
  return { db, d1 };
};

const insertNote = (db: DatabaseSync, note: { id: string; content: string; createdAt: number }) => {
  db.prepare(
    "INSERT INTO memory_note (id, user_id, character_id, content, created_at, usage_count) VALUES (?, ?, ?, ?, ?, 0)",
  ).run(note.id, USER_ID, CHARACTER_ID, note.content, note.createdAt);
};

const seed = (db: DatabaseSync) => {
  // 200日前の一致ノート。作成順では最下位なので、created_at DESC LIMIT 20 では絶対に届かん。
  insertNote(db, {
    id: OLD_RELEVANT_ID,
    content: OLD_RELEVANT_CONTENT,
    createdAt: NOW - 200 * DAY_MS,
  });
  // 10日前〜56日前に散らばる無関係ノート。turn とは語がまったく重ならん。
  for (let index = 0; index < FILLER_COUNT; index += 1) {
    insertNote(db, {
      id: `note-filler-${index}`,
      content: `厩舎の掃除当番を${index + 1}回まわした`,
      createdAt: NOW - (10 + index * 2) * DAY_MS,
    });
  }
};

const relevanceContext: MemoryRelevanceContext = {
  recentMessagesText: CURRENT_TURN,
  characterName: "みお",
  now: NOW,
};

describe.skipIf(!DatabaseSyncCtor)("fetchRecentMemoryNotes の関連度取得", () => {
  it("古いが今の turn に一致するノートを候補へ入れ、新しいが無関係なノートより上位に並べる", async () => {
    const { db, d1 } = makeRealD1();
    seed(db);
    const database = drizzle(d1 as unknown as D1Database);

    const candidates = await fetchRecentMemoryNotes(database, USER_ID, CHARACTER_ID, CURRENT_TURN);

    expect(candidates.map((note) => note.id)).toContain(OLD_RELEVANT_ID);

    const selected = selectRelevantMemories(candidates, relevanceContext, 8);
    const selectedIds = selected.map((note) => note.id);
    expect(selectedIds).toContain(OLD_RELEVANT_ID);
    // 新しいだけの無関係ノート（10日前 = 候補中で最新）より上に来なあかん。
    expect(selectedIds.indexOf(OLD_RELEVANT_ID)).toBeLessThan(selectedIds.indexOf("note-filler-0"));
  });

  it("一致語が無い turn では直近20件のまま返す（recency フォールバック）", async () => {
    const { db, d1 } = makeRealD1();
    seed(db);
    const database = drizzle(d1 as unknown as D1Database);

    const candidates = await fetchRecentMemoryNotes(
      database,
      USER_ID,
      CHARACTER_ID,
      "ぜんぜん別の話をしよう",
    );

    expect(candidates).toHaveLength(20);
    expect(candidates.map((note) => note.id)).toEqual(
      Array.from({ length: 20 }, (_, index) => `note-filler-${index}`),
    );
  });

  // 検索語を窓（直近5往復）の全体から取ると、いま話してへん前の話題が候補を決めてまう。
  // 語は最新の発話からだけ取る。ここでは最新の発話に話題語が無いので recency へ落ちる。
  it("窓の中の古い発話やのうて、最新の発話からだけ検索語を取る", async () => {
    const { db, d1 } = makeRealD1();
    seed(db);
    const database = drizzle(d1 as unknown as D1Database);

    const candidates = await fetchRecentMemoryNotes(
      database,
      USER_ID,
      CHARACTER_ID,
      `${CURRENT_TURN}\nそやな`,
    );

    expect(candidates.map((note) => note.id)).not.toContain(OLD_RELEVANT_ID);
    expect(candidates).toHaveLength(20);
  });

  // 「でした」「まわした」のような活用語尾はどのノートにも入っとる。これを検索語にすると
  // 一致数が話題と無関係に膨らみ、候補が絞れんまま古いノートが混ざる。
  it("ひらがなだけの活用語尾では古いノートを引っ張らん", async () => {
    const { db, d1 } = makeRealD1();
    seed(db);
    insertNote(db, {
      id: INFLECTION_ONLY_ID,
      // 今の turn とは話題が全く違うのに、活用語尾（はよ/よく/まし/した）が4つも重なる。
      // 語尾を検索語にすると、この一致数で filler より上位に来てまう。
      content: "ユーザーはよく夜更かしをしました",
      createdAt: NOW - 200 * DAY_MS,
    });
    const database = drizzle(d1 as unknown as D1Database);

    const candidates = await fetchRecentMemoryNotes(
      database,
      USER_ID,
      CHARACTER_ID,
      "今日はよく寝ました",
    );

    expect(candidates.map((note) => note.id)).not.toContain(INFLECTION_ONLY_ID);
    expect(candidates).toHaveLength(20);
  });

  it("turn を渡さん呼び出しは従来どおり直近20件だけを返す", async () => {
    const { db, d1 } = makeRealD1();
    seed(db);
    const database = drizzle(d1 as unknown as D1Database);

    const candidates = await fetchRecentMemoryNotes(database, USER_ID, CHARACTER_ID);

    expect(candidates).toHaveLength(20);
    expect(candidates.map((note) => note.id)).not.toContain(OLD_RELEVANT_ID);
  });
});
