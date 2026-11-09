// D1Database は @cloudflare/workers-types のグローバル型。消費側は各 tsconfig の types で解決する。
// （`/// <reference types>` はパッケージ index.ts を別バージョンの型コピーとして引き込み、
// 生成済み worker-configuration.d.ts との重複宣言で env 型を潰すため置けない）
// D1Database から drizzle クライアントを作る。ファイル単位で必要な既存スキーマだけ束ねる
// （src/schema/index.ts を経由すると rag-chunk.ts → src/lib/scene-phase.ts まで型解決が伸びる）。
import { drizzle } from "drizzle-orm/d1";

import { characterTable } from "../../../src/schema/character";
import { conversationTable } from "../../../src/schema/conversation";
import { messageTable } from "../../../src/schema/message";
import { userTable } from "../../../src/schema/user";

import * as v2Schema from "./v2-schema";

export const schema = {
  characterTable,
  userTable,
  conversationTable,
  messageTable,
  ...v2Schema,
};

export type V2Db = ReturnType<typeof drizzle<typeof schema>>;

export const createDb = (d1: D1Database): V2Db => drizzle(d1, { schema });
