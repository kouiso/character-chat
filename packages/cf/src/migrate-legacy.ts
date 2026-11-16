import { parseArgs } from "node:util";

import { createDb, conversationTable, migrateLegacyConversations } from "@v2/db";

import { assertLocalOnly } from "./assert-local";

import { createPlatform } from "./index";

// 復元コピーの移行は手元だけで回す。--remote を付けても本番 D1 へは届かせん。
assertLocalOnly(process.argv.slice(2));
const { values } = parseArgs({
  options: {
    "persist-root": { type: "string" },
    "source-user": { type: "string" },
    "target-user": { type: "string" },
    apply: { type: "boolean", default: false },
  },
});
const platform = await createPlatform({ persistRoot: values["persist-root"] });
try {
  const db = createDb(platform.env.DB);
  const users = await db.selectDistinct({ id: conversationTable.userId }).from(conversationTable);
  const sourceUserId = values["source-user"] ?? (users.length === 1 ? users[0].id : undefined);
  if (!sourceUserId || !values["target-user"]) {
    throw new Error(
      "--source-user と --target-user を指定してください（複数の利用者を自動で統合しません）",
    );
  }
  // 確認（--apply なし）も本番と同じ照合を通し、書き込みだけを飛ばす。「確認は通ったのに適用で失敗」を無くす。
  // 手元のコピーは全件を1回で回すので limit を付けず、要確認は failures に集めて出口コードで返す。
  const mode = values.apply ? "local-apply" : "inspect";
  const report = await migrateLegacyConversations(db, {
    sourceUserId,
    targetUserId: values["target-user"],
    apply: values.apply,
  });
  process.stdout.write(`${JSON.stringify({ mode, owners: users.length, ...report })}\n`);
  if (report.failures.length > 0) process.exitCode = 1;
} finally {
  await platform.dispose();
}
