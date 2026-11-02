import { userTable } from "../../../src/schema/user";

import type { V2Db } from "./client";

export const ensureLocalUser = async (db: V2Db): Promise<void> => {
  await db
    .insert(userTable)
    .values({
      id: "local",
      email: "local@example.invalid",
      createdAt: Date.now(),
    })
    .onConflictDoNothing();
};
