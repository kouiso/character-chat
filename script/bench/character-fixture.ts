// キャラシートを**リポジトリの中だけ**から組み立てる。
//
// なぜ要るか: P1 で新しい条件を回すには system_prompt が要るが、既存の
// script/verify/vlong-session-dogfood.ts:162 は GET /api/characters でサーバ越しに取る。
// 台（サーバ + D1）が要る時点で、台の故障を丸ごと相続してまう。bench は台に依存せん。
//
// **本番 D1 と一致する保証は無い。**リポジトリから再構成できるのは次の2通りで、
// どちらも本番とはズレる経路がある。どっちを使ったかは呼び手が明示する。
//
//  1. "migrations" — drizzle/0000（スキーマ）→ script/seed.ts → 残りの drizzle/*.sql をファイル名順。
//     persona を書き換えた 0064〜0068 が効いた後の姿になる。
//  2. "seed" — script/seed.ts の行そのもの。`pnpm dev:reset`（migrate → seed、seed は
//     INSERT OR REPLACE）を回した直後のローカル D1 と同じ姿。
//
// 本番とズレる経路（実測で確かめた）:
//  - `drizzle/meta/_journal.json` の entries は 29 本、`drizzle/*.sql` は 85 本。
//    本番へ流す `wrangler d1 migrations apply` は journal 準拠なので、**0065〜0068 は
//    journal に無い**（各ファイルのヘッダが「本番へは適用済み」と手作業を明記しとる）。
//  - journal の順序は辞書順やない。REPLACE を連ねた migration では順序が結果を変える。
//  - "migrations" と "seed" で Sakura の system_prompt は 1,252字 / 1,371字で別物になる。
//
// つまりここが返すのは「リポジトリに記録されとる設定から組み直したシート」であって、
// 「いま本番が使っとるシート」やない。条件を再現したい時はどっちを使ったかまで書くこと。

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { normalizeSheetText } from "../../packages/judge/src/sheet-text";

import { characters } from "../seed";

export type BenchCharacter = {
  id: string;
  name: string;
  systemPrompt: string;
  greeting: string;
  /** どの経路で組んだシートか。生成した条件の記録へ必ず残す */
  source: CharacterSource;
};

export const CHARACTER_SOURCES = ["migrations", "seed"] as const;
export type CharacterSource = (typeof CHARACTER_SOURCES)[number];

const MIGRATION_DIR = path.resolve(import.meta.dirname, "..", "..", "drizzle");

const statementsOf = (sql: string): string[] =>
  sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

const applyFile = (db: DatabaseSync, file: string): void => {
  for (const statement of statementsOf(readFileSync(file, "utf-8"))) db.exec(statement);
};

const insertSeedCharacters = (db: DatabaseSync): void => {
  // character.user_id が user を参照しとる。読むのは system_prompt だけやが、
  // 外部キーを満たさんと INSERT が通らんので所有者の行も1つ作る。
  db.prepare(
    "INSERT OR IGNORE INTO user (id, email, created_at) VALUES ('seed-user', 'seed@local', 0)",
  ).run();
  const insert = db.prepare(
    "INSERT OR IGNORE INTO character (id, user_id, name, avatar, system_prompt, greeting, tags, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  for (const character of characters) {
    insert.run(
      character.id,
      "seed-user",
      character.name,
      character.avatar,
      character.systemPrompt,
      character.greeting,
      JSON.stringify(character.tags),
      0,
    );
  }
};

/** シード投入 → migration 適用の順で、いまの character 表をメモリ上に組み直す */
export const buildCharacterTable = (migrationDir = MIGRATION_DIR): DatabaseSync => {
  const files = readdirSync(migrationDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  if (files.length === 0) throw new Error(`migration が1つも無い: ${migrationDir}`);
  const db = new DatabaseSync(":memory:");
  applyFile(db, path.join(migrationDir, files[0]));
  insertSeedCharacters(db);
  for (const file of files.slice(1)) applyFile(db, path.join(migrationDir, file));
  return db;
};

const loadFromSeed = (id: string): BenchCharacter | null => {
  const seeded = characters.find((character) => character.id === id);
  if (!seeded) return null;
  return {
    id: seeded.id,
    name: seeded.name,
    systemPrompt: seeded.systemPrompt,
    greeting: seeded.greeting,
    source: "seed",
  };
};

export const loadCharacter = (
  id: string,
  source: CharacterSource = "migrations",
  migrationDir = MIGRATION_DIR,
): BenchCharacter => {
  if (source === "seed") {
    const seeded = loadFromSeed(id);
    if (!seeded) throw new Error(`seed.ts にキャラが見つからん: ${id}`);
    return seeded;
  }
  const db = buildCharacterTable(migrationDir);
  const row = db
    .prepare("SELECT id, name, system_prompt AS systemPrompt, greeting FROM character WHERE id = ?")
    .get(id) as Omit<BenchCharacter, "source"> | undefined;
  db.close();
  if (!row) throw new Error(`キャラが見つからん: ${id}`);
  if (!row.systemPrompt.trim()) throw new Error(`system_prompt が空: ${id}`);
  return { ...row, source };
};

// system_prompt の「forbidden_words: 語、語」行を配列にする。テスト側が禁止語リストを
// 独自に持たず、シートの実際の値を読んで判定できるようにするための小さな抽出器
// （packages/judge/src/forbidden-word-check.ts の同名パターンと同じ考え方）。
const FORBIDDEN_WORDS_LINE_PATTERN = /^forbidden_words:\s*(.+)$/mu;

export const parseForbiddenWords = (systemPrompt: string): string[] => {
  // 本番のシートは改行が「\n」の2文字で入っとることがある。judge 側と同じ畳み方を使う。
  const match = normalizeSheetText(systemPrompt).match(FORBIDDEN_WORDS_LINE_PATTERN);
  if (!match) return [];
  return match[1]
    .split(/[、,]/u)
    .map((word) => word.trim())
    .filter((word) => word.length > 0);
};

/** vlong-dogfood と同じ2体。条件を既存29本の隣に並べられるように id を揃えとく */
export const DOGFOOD_CHARACTER_IDS = {
  sakura: "char-koharu-ex",
  downer: "import-charap-ダウナーお姉さんに拾われる話",
} as const;

export type DogfoodCharacterKey = keyof typeof DOGFOOD_CHARACTER_IDS;
