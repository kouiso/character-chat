import * as dbExports from "@v2/db";
import { ConversationAccessError, type V2Db } from "@v2/db";

import type { ChatSseEvent, ChatChunkDelivery } from "../lib/sse-events";
import type { JudgeResult } from "@v2/judge";

export class StoredReplyConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoredReplyConflictError";
  }
}

export type ChunkDelivery = ChatChunkDelivery;

type DeliveryScope = { userId: string; characterId: string; conversationId: string };
type DeliveryLoader = (db: V2Db, scope: DeliveryScope) => Promise<ChunkDelivery[] | null>;
const isDeliveryLoader = (value: unknown): value is DeliveryLoader => typeof value === "function";

// 旧runtimeの型でも検証できるようにし、統合先では既存のowner-scoped readerを正とする。
export const readChunkDelivery = async (
  db: V2Db,
  scope: DeliveryScope,
  turn: number,
): Promise<ChunkDelivery | null | undefined> => {
  const loader: unknown = Reflect.get(dbExports, "loadChunkDeliveries");
  if (!isDeliveryLoader(loader)) return undefined;
  const deliveries = await loader(db, scope);
  if (deliveries === null) throw new ConversationAccessError();
  return (
    deliveries.find(
      (delivery) => delivery.turn === turn && delivery.conversationId === scope.conversationId,
    ) ?? null
  );
};

type StoredChunk = {
  seq: number;
  text: string;
  judge_json: string;
  attempt: number;
  scheduled_at?: number | null;
  assistant_created_at: number;
};

// 所有権と生成idの確認は呼出元に集め、配送用の値は保存済みの行から復元する。
export const readStoredReplyEvents = async (
  database: Pick<D1Database, "prepare">,
  conversationId: string,
  turn: number,
  generationId: string,
): Promise<ChatSseEvent[]> => {
  const { results } = await database
    .prepare(
      `
    SELECT chunk.*, message.created_at AS assistant_created_at FROM v2_chunk AS chunk
    INNER JOIN v2_message AS message ON message.id = chunk.message_id
    WHERE message.conversation_id = ? AND message.turn = ?
      AND message.role = 'assistant' AND message.generation_id = ?
    ORDER BY chunk.seq
  `,
    )
    .bind(conversationId, turn, generationId)
    .all<StoredChunk>();
  return results.map((row) => ({
    type: "chunk",
    seq: row.seq,
    text: row.text,
    judge: JSON.parse(row.judge_json) as JudgeResult,
    attempt: row.attempt,
    preExtend: false,
    scheduledAt: row.scheduled_at ?? row.assistant_created_at,
  }));
};
