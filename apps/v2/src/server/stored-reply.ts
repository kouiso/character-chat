import type { ChatSseEvent } from "../lib/sse-events";
import type { JudgeResult } from "@v2/judge";

type StoredChunk = {
  seq: number;
  text: string;
  judge_json: string;
  attempt: number;
  scheduled_at?: number | null;
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
    SELECT chunk.* FROM v2_chunk AS chunk
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
    ...(row.scheduled_at === null || row.scheduled_at === undefined
      ? {}
      : { scheduledAt: row.scheduled_at }),
  }));
};
