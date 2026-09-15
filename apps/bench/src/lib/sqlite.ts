import { readFileSync } from "node:fs";

// この空行は消さんこと。リポジトリの lint は Node 22 で走り、そこでは node:sqlite が
// 組み込み扱いにならんので import/order が空行を要求する。Node 24 の eslint --fix を
// このファイルに掛けると空行を消してしまい、pnpm lint が落ちる。
import { DatabaseSync } from "node:sqlite";

// node:sqlite の import をここ1箇所に閉じ込める。Node 22 は「外部」、Node 24 は「組み込み」と
// 分類するせいで、呼び出し側に置くと import/order がどちらかで必ず落ちるからや。

/** ダンプ(.sql)をメモリ上の DB に流し込む。FK 順に並んどらんので制約は切る */
export function openDumpDatabase(sqlPath: string): DatabaseSync {
  const db = new DatabaseSync(":memory:", {
    enableForeignKeyConstraints: false,
  });
  db.exec(readFileSync(sqlPath, "utf8"));
  return db;
}

export type { DatabaseSync };
