import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const userTable = sqliteTable("user", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  createdAt: integer("created_at", { mode: "number" }).notNull(),
  // #1224/#1228: アカウント単位の呼ばれ方の既定値。キャラ個別の userPersonaName が
  // 優先され、これはそれが未設定の時だけ使うフォールバック。
  displayName: text("display_name"),
});
