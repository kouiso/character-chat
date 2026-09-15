// 本番 D1 から吸い出したシートを読む。リポジトリの fixture（character-fixture.ts）は
// drizzle + seed から組み直した 190 体で、本番に実際に入っとる 221 体とは別物。
// judge の判定をシートへ当てる話では、本番の方が「実際に使われとる入力」になる。
//
// .work/d1-export/ は git 管理外（吸い出した実データなので置いたままにせん）。
// 無い時は空で返す——呼び手がスキップの理由を出せるように、例外にはせん。
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { DatabaseSync } from "node:sqlite";

import { normalizeSheetText } from "../../packages/judge/src/sheet-text";

export type ProductionCharacter = { id: string; name: string; systemPrompt: string };

export const PRODUCTION_EXPORT_PATH = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  ".work",
  "d1-export",
  "character.sql",
);

export const productionExportExists = (exportPath = PRODUCTION_EXPORT_PATH): boolean =>
  existsSync(exportPath);

export const loadProductionCharacters = (
  exportPath = PRODUCTION_EXPORT_PATH,
): ProductionCharacter[] => {
  if (!existsSync(exportPath)) return [];
  const db = new DatabaseSync(":memory:");
  // 吸い出した character 表は user を参照しとる。読むのは system_prompt だけなので、
  // 参照先の空表だけ先に作って外部キーは切る。
  db.exec("PRAGMA foreign_keys=OFF");
  db.exec("CREATE TABLE IF NOT EXISTS user (id text PRIMARY KEY)");
  db.exec(readFileSync(exportPath, "utf-8"));
  const rows = db
    .prepare("SELECT id, name, system_prompt AS systemPrompt FROM character")
    .all() as ProductionCharacter[];
  db.close();
  // 読み込みの時点でも畳んでおく。パーサ側も畳むので二重やが、シートを直に見る道具
  // （sweep・目視）でも同じ形で見えた方がええ。
  return rows
    .map((row) => ({ ...row, systemPrompt: normalizeSheetText(row.systemPrompt) }))
    .filter((row) => row.systemPrompt.trim().length > 0);
};
