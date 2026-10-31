import { parseArgs } from "node:util";

import { createDb, conversationTable, migrateLegacyConversations } from "@v2/db";

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
      "Specify source-user and target-user; multiple owners are never implicitly merged",
    );
  }
  if (!values.apply) {
    process.stdout.write(
      `${JSON.stringify({ mode: "inspect", owners: users.length, ready: true })}\n`,
    );
  } else {
    const result = await migrateLegacyConversations(db, {
      sourceUserId,
      targetUserId: values["target-user"],
    });
    process.stdout.write(`${JSON.stringify({ mode: "local-apply", ...result })}\n`);
  }
} finally {
  await platform.dispose();
}
