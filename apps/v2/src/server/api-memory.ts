import {
  addMemory,
  changeMemory,
  ConversationAccessError,
  createDb,
  listMemories,
  MemoryConflictError,
  removeMemory,
} from "@v2/db";
import {
  memoryChangeSchema,
  memoryDeleteSchema,
  memoryIdSchema,
  newMemorySchema,
} from "@v2/db/memory-contract";

import { LOCAL_USER_ID } from "./identity";
import { getPlatform } from "./platform";

const json = (status: number, body: unknown) =>
  Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store" },
  });

const writeMemory = async (
  db: ReturnType<typeof createDb>,
  scope: { userId: string; characterId: string; conversationId: string },
  method: string,
  body: unknown,
) => {
  if (method === "POST") {
    const parsed = newMemorySchema.safeParse(body);
    if (parsed.success) return json(200, { memory: await addMemory(db, scope, parsed.data) });
  } else if (method === "PUT") {
    const parsed = memoryChangeSchema.safeParse(body);
    if (parsed.success) return json(200, { memory: await changeMemory(db, scope, parsed.data) });
  } else if (method === "DELETE") {
    const parsed = memoryDeleteSchema.safeParse(body);
    if (parsed.success) {
      await removeMemory(db, scope, parsed.data);
      return json(200, { deleted: true });
    }
  } else {
    return json(405, { message: "この操作には対応していません。" });
  }
  return json(400, { message: "記憶は空欄にせず、1,000字以内で入力してください。" });
};

export const handleMemoryRequest = async (characterId: string, request: Request) => {
  const conversation = memoryIdSchema.safeParse(
    new URL(request.url).searchParams.get("conversationId"),
  );
  if (!memoryIdSchema.safeParse(characterId).success || !conversation.success) {
    return json(400, { message: "会話を選んでください。" });
  }
  const scope = { userId: LOCAL_USER_ID, characterId, conversationId: conversation.data };
  try {
    const { env } = await getPlatform();
    const db = createDb(env.DB);
    if (request.method === "GET") return json(200, { memories: await listMemories(db, scope) });
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json(400, { message: "送信内容を確認してください。" });
    }
    return await writeMemory(db, scope, request.method, body);
  } catch (error) {
    if (error instanceof ConversationAccessError)
      return json(404, { message: "会話が見つかりません。" });
    if (error instanceof MemoryConflictError) return json(409, { message: error.message });
    return json(503, {
      message: "記憶を保存・読込できませんでした。入力を残したまま再試行できます。",
    });
  }
};
