// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { DatabaseSync } from "node:sqlite";

// #1490「キャラ名表示するところフリガナ振って」。読みの列が無かったので足す。
// 読みはシートに書かれとらんので migration が直接当てる。当たらん・当たり過ぎる、の
// どちらも画面に出るまで気づかんので、実際に走らせて確かめる。

const ROOT = path.resolve(__dirname, "../../..");
const migration = readFileSync(path.join(ROOT, "drizzle/0075_character_name_reading.sql"), "utf8");

let DatabaseSyncCtor: typeof DatabaseSync | undefined;
try {
  const mod = await import("node:sqlite");
  DatabaseSyncCtor = mod.DatabaseSync;
} catch (error) {
  console.warn("node:sqlite unavailable; migration tests will be skipped", error);
}

const migrate = (rows: { id: string; name: string }[]): Map<string, string | null> => {
  if (!DatabaseSyncCtor) throw new Error("node:sqlite is not available");
  const database = new DatabaseSyncCtor(":memory:");
  database.exec("CREATE TABLE character (id TEXT PRIMARY KEY, name TEXT NOT NULL)");
  const insert = database.prepare("INSERT INTO character (id, name) VALUES (?, ?)");
  for (const row of rows) insert.run(row.id, row.name);
  database.exec(migration);
  const read = database.prepare("SELECT id, name_reading FROM character").all() as {
    id: string;
    name_reading: string | null;
  }[];
  database.close();
  return new Map(read.map((row) => [row.id, row.name_reading]));
};

describe.skipIf(!DatabaseSyncCtor)("0075 キャラ名の読み", () => {
  it("人名のキャラへ読みが入る", () => {
    const readings = migrate([
      { id: "import-charap-ダウナーお姉さんに拾われる話", name: "霜月 鈴" },
      { id: "char-koharu-ex", name: "桜庭 さくら" },
    ]);

    expect(readings.get("import-charap-ダウナーお姉さんに拾われる話")).toBe("しもつきすず");
    expect(readings.get("char-koharu-ex")).toBe("さくらばさくら");
  });

  // インポート分の多くは人名やのうてシナリオの題。読みを当てたらルビが文章に化ける。
  it("人名やないキャラは読みを持たんまま", () => {
    const readings = migrate([{ id: "import-saylo-オヤジ狩り", name: "オヤジ狩り" }]);

    expect(readings.get("import-saylo-オヤジ狩り")).toBeNull();
  });

  it("読みは全部かな（漢字が混じっとったらルビにならん）", () => {
    const values = [...migration.matchAll(/name_reading = '([^']+)'/g)].map((match) => match[1]);

    expect(values.length).toBeGreaterThan(50);
    for (const value of values) expect(value).toMatch(/^[ぁ-んー]+$/);
  });
});
