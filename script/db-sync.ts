#!/usr/bin/env tsx
/**
 * D1 sync ユーティリティ
 *
 * push（local → prod, キャラ単位）:
 *   tsx script/db-sync.ts dry     -- 差分表示のみ（prod 書き込みなし）
 *   tsx script/db-sync.ts apply   -- 新規キャラを prod へ INSERT OR IGNORE
 *
 * catalog pull（prod → local, キャラカタログ一式）:
 *   tsx script/db-sync.ts catalog -- prod のカタログ系テーブルを local へ
 *                                    INSERT OR REPLACE で冪等に取り込む（再実行可）
 */
import { execSync } from "child_process";

const DB_NAME = "adult-ai-db";
// e2e テストユーザーのメールパターン（local D1 の e2e キャラを除外するため）
const E2E_EMAIL_PATTERN = "e2e-%@adult-ai-app.local";

type CharRow = {
  id: string;
  name: string;
  user_id: string;
  avatar: string | null;
  system_prompt: string;
  visual_prompt: string | null;
  image_meta: string | null;
  greeting: string;
  tags: string;
  user_persona_name: string | null;
  user_persona_gender: string | null;
  user_persona_personality: string | null;
  display_order: number;
  created_at: number;
};

type UserRow = { id: string; email: string; created_at: number };

/**
 * キャラカタログ系テーブルの定義。
 * order は親 → 子 の FK 依存順を表し、catalog pull はこの昇順で適用する。
 * conversation / message / scene_bookmark / rate-limit / user などの
 * per-user・runtime テーブルは含めない（カタログ＝キャラ素材のみ同期する）。
 */
export type CatalogTable = {
  name: string;
  /** 親 → 子 の依存順序。同値なら互いに依存しない。 */
  order: number;
};

export const CATALOG_TABLES: readonly CatalogTable[] = [
  // 親（character は user を参照するが user は per-user テーブルなので
  //   カタログ対象外。INSERT OR REPLACE は local 既存 user 行を前提とする）
  { name: "character", order: 0 },
  { name: "scene_location", order: 0 },
  // scene_location の子
  { name: "scene_location_tag", order: 1 },
  // character の子（visual 系）
  { name: "character_visual", order: 1 },
  { name: "character_distinctive_mark", order: 1 },
  { name: "character_default_outfit_tag", order: 1 },
  { name: "character_undress_progression", order: 1 },
  { name: "character_sub_image", order: 1 },
  // character の子（wardrobe）
  { name: "wardrobe_outfit", order: 1 },
  // wardrobe_outfit の子
  { name: "wardrobe_outfit_tag", order: 2 },
  { name: "wardrobe_outfit_occasion", order: 2 },
] as const;

function wranglerQuery<T>(sql: string, remote: boolean): T[] {
  const flag = remote ? "--remote" : "--local";
  // wrangler d1 execute --command は単一クォートを含むと bash 展開されるため --file 経由が安全だが
  // ここでは --json + stdin 経由で渡す
  const escaped = sql.replace(/"/g, '\\"');
  const out = execSync(
    `npx wrangler d1 execute ${DB_NAME} ${flag} --json --command "${escaped}"`,
    { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
  );
  const parsed = JSON.parse(out) as Array<{ results?: T[] }>;
  return parsed[0]?.results ?? [];
}

function sqlEscape(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  // 数値は引用なしで埋め込む。NaN/Infinity は SQL 表現がないため NULL に倒す
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** カタログ pull で 1 テーブル分の prod 行データ。 */
export type CatalogTableData = {
  name: string;
  /** prod から取得した行（カラム名 → 値）。 */
  rows: Array<Record<string, unknown>>;
};

/**
 * カタログ同期の SQL を生成する純粋関数（live D1 不要・テスト可能）。
 *
 * - テーブルは CATALOG_TABLES の親→子 FK 順に並べ替えてから出力する
 * - 各行は INSERT OR REPLACE で出力し、再実行しても重複・FK 違反を起こさない
 * - rows が空のテーブルは SQL を生成しない
 *
 * @param tables prod から取得したテーブル別の行データ
 * @returns 適用順に並んだ INSERT OR REPLACE 文の配列
 */
export function buildCatalogSyncSql(tables: CatalogTableData[]): string[] {
  const orderOf = new Map(CATALOG_TABLES.map((t) => [t.name, t.order]));
  // CATALOG_TABLES に無いテーブルは末尾扱い（=Number.MAX_SAFE_INTEGER）にして
  // カタログ定義の親子順を尊重しつつ未知テーブルでも壊れないようにする
  const indexOf = (name: string) => {
    const i = CATALOG_TABLES.findIndex((t) => t.name === name);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const ordered = [...tables].sort((a, b) => {
    const oa = orderOf.get(a.name) ?? Number.MAX_SAFE_INTEGER;
    const ob = orderOf.get(b.name) ?? Number.MAX_SAFE_INTEGER;
    if (oa !== ob) return oa - ob;
    // order が同値なら CATALOG_TABLES の宣言順で安定ソートする
    return indexOf(a.name) - indexOf(b.name);
  });

  const statements: string[] = [];
  for (const table of ordered) {
    if (table.rows.length === 0) continue;
    // カラム集合は先頭行から決定する（D1 の SELECT * は全行同一スキーマ）
    const cols = Object.keys(table.rows[0]);
    for (const row of table.rows) {
      const vals = cols.map((c) => sqlEscape(row[c]));
      statements.push(
        `INSERT OR REPLACE INTO ${table.name} (${cols.join(", ")}) VALUES (${vals.join(", ")});`,
      );
    }
  }
  return statements;
}

function runCatalogPull(): void {
  console.log("Pulling catalog tables: prod → local (INSERT OR REPLACE)...");

  const tableData: CatalogTableData[] = [];
  for (const { name } of CATALOG_TABLES) {
    const rows = wranglerQuery<Record<string, unknown>>(
      `SELECT * FROM ${name}`,
      true,
    );
    tableData.push({ name, rows });
    console.log(`  prod ${name}: ${rows.length} rows`);
  }

  const statements = buildCatalogSyncSql(tableData);
  if (statements.length === 0) {
    console.log("✓ prod カタログは空 — local への適用なし");
    return;
  }

  // 親→子順で 1 文ずつ local に適用する（INSERT OR REPLACE なので再実行可）
  let applied = 0;
  for (const sql of statements) {
    wranglerQuery<unknown>(sql, false);
    applied++;
  }
  console.log(`\n✓ Done: ${applied} rows synced into local (re-runnable)`);
}

function runPush(mode: "dry" | "apply"): void {
  console.log("Querying local D1...");
  const localChars = wranglerQuery<CharRow>(
    `SELECT c.id, c.name, c.user_id, c.avatar, c.system_prompt, c.visual_prompt,` +
      ` c.image_meta, c.greeting, c.tags, c.user_persona_name, c.user_persona_gender,` +
      ` c.user_persona_personality, c.display_order, c.created_at` +
      ` FROM character c LEFT JOIN user u ON c.user_id = u.id` +
      ` WHERE u.email IS NULL OR u.email NOT LIKE '${E2E_EMAIL_PATTERN}'`,
    false,
  );

  console.log("Querying prod D1...");
  const prodCharIds = new Set(
    wranglerQuery<{ id: string }>(`SELECT id FROM character`, true).map(
      (r) => r.id,
    ),
  );
  const prodUserIds = new Set(
    wranglerQuery<{ id: string }>(`SELECT id FROM user`, true).map((r) => r.id),
  );

  const newChars = localChars.filter((c) => !prodCharIds.has(c.id));

  console.log(`Local chars (excl. e2e): ${localChars.length}`);
  console.log(`Prod chars:              ${prodCharIds.size}`);
  console.log(`New chars to push:       ${newChars.length}`);

  if (newChars.length === 0) {
    console.log("✓ 差分なし — prod は最新");
    return;
  }

  console.log("\n対象キャラ:");
  for (const c of newChars) {
    console.log(`  - ${c.name} (${c.id})`);
  }

  if (mode === "dry") {
    console.log(
      "\n[dry-run] prod への書き込みなし。実行するには: tsx script/db-sync.ts apply",
    );
    return;
  }

  // apply: user FK を先に upsert してからキャラを INSERT OR IGNORE
  const localUsers = wranglerQuery<UserRow>(
    `SELECT id, email, created_at FROM user WHERE id IN (${newChars.map((c) => sqlEscape(c.user_id)).join(",")})`,
    false,
  );
  const userMap = new Map(localUsers.map((u) => [u.id, u]));

  const CHAR_COLS = [
    "id", "name", "user_id", "avatar", "system_prompt", "visual_prompt",
    "image_meta", "greeting", "tags", "user_persona_name", "user_persona_gender",
    "user_persona_personality", "display_order", "created_at",
  ] as const;

  let pushed = 0;
  for (const c of newChars) {
    // user FK が prod に存在しない場合は先に INSERT OR IGNORE
    if (!prodUserIds.has(c.user_id)) {
      const u = userMap.get(c.user_id);
      if (u) {
        wranglerQuery<unknown>(
          `INSERT OR IGNORE INTO user (id, email, created_at) VALUES (${sqlEscape(u.id)}, ${sqlEscape(u.email)}, ${sqlEscape(u.created_at)})`,
          true,
        );
        prodUserIds.add(u.id);
        console.log(`  ✓ user upserted: ${u.email}`);
      }
    }

    const vals = CHAR_COLS.map((col) => sqlEscape(c[col]));
    wranglerQuery<unknown>(
      `INSERT OR IGNORE INTO character (${CHAR_COLS.join(", ")}) VALUES (${vals.join(", ")})`,
      true,
    );
    console.log(`  ✓ char inserted: ${c.name}`);
    pushed++;
  }

  console.log(`\n✓ Done: ${pushed}/${newChars.length} characters pushed to prod`);
}

function main(): void {
  const mode = process.argv[2];
  if (mode === "dry" || mode === "apply") {
    runPush(mode);
    return;
  }
  if (mode === "catalog") {
    runCatalogPull();
    return;
  }
  console.error("Usage: tsx script/db-sync.ts dry|apply|catalog");
  process.exit(1);
}

// テストから import した場合は副作用なし。CLI 実行時のみ main を呼ぶ。
const invokedDirectly =
  typeof process.argv[1] === "string" && process.argv[1].endsWith("db-sync.ts");
if (invokedDirectly) {
  main();
}
