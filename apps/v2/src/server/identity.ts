// 個人用BASIC認証の所有者IDは資格情報の更新では変えない。
import { characterTable, listLegacySourceUserIds } from "@v2/db";
import { eq } from "drizzle-orm";

import type { V2Db } from "@v2/db";

export const LOCAL_USER_ID = "local";

// 持ち主の名義の集合: local と、移した会話が残した旧名義の全部。同一人物として扱う
// 読み方はこの関数だけが作る（同じ式が各所へ写ると片方だけ直した時に見え方がずれる）。
export const listOwnerIds = async (db: V2Db): Promise<string[]> => [
  LOCAL_USER_ID,
  ...(await listLegacySourceUserIds(db)),
];

// 編集APIに渡す所有名義。行の名義が持ち主の集合に入ればその名義（旧名義のキャラを
// 本人が直せる）、入らなければ local（所有確認が今までどおり拒否する形）。
export const resolveEditorUserId = async (db: V2Db, characterId: string): Promise<string> => {
  const [row] = await db
    .select({ userId: characterTable.userId })
    .from(characterTable)
    .where(eq(characterTable.id, characterId));
  if (!row) return LOCAL_USER_ID;
  return (await listOwnerIds(db)).includes(row.userId) ? row.userId : LOCAL_USER_ID;
};
