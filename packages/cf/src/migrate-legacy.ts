import { parseArgs } from "node:util";

import {
  createDb,
  conversationTable,
  LegacyMigrationError,
  migrateLegacyConversations,
} from "@v2/db";

import { createPlatform } from "./index";

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
  if (!values.apply) {
    process.stdout.write(
      `${JSON.stringify({ mode: "inspect", owners: users.length, ready: true })}\n`,
    );
  } else {
    const outcome = await migrateLegacyConversations(db, {
      sourceUserId,
      targetUserId: values["target-user"],
    }).catch((error: unknown) => {
      if (error instanceof LegacyMigrationError) return error;
      throw error;
    });
    // 移行できた会話の件数と、確認が要る会話の一覧を両方残して失敗で終える。
    const report =
      outcome instanceof LegacyMigrationError
        ? { ...outcome.result, failures: outcome.failures }
        : outcome;
    process.stdout.write(`${JSON.stringify({ mode: "local-apply", ...report })}\n`);
    if (outcome instanceof LegacyMigrationError) process.exitCode = 1;
  }
} finally {
  await platform.dispose();
}
