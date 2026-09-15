import { REPO_ROOT } from "./env.ts";
import { openDumpDatabase } from "./sqlite.ts";

// シナリオの user 発話は、既存バックアップの実物をそのまま再生する。
// AI に代理生成させるとユーザーターン自体が AI 臭くなってテストの意味が消えるからや。

export const DEFAULT_DUMP = `${REPO_ROOT}.work/backups/chat-history/20260628T101036/d1-full.sql`;

export type Scenario = {
  id: string;
  characterName: string;
  characterPrompt: string;
  greeting: string;
  userTurns: string[];
};

/** 既存会話の user 発話を順番どおりに取り出す。尻すぼみが起きた本物の条件を再現するため */
export function loadReplayScenario(
  conversationId: string,
  sqlPath: string = DEFAULT_DUMP,
): Scenario {
  const db = openDumpDatabase(sqlPath);
  try {
    const meta = db
      .prepare(
        "select ch.name as name, ch.system_prompt as systemPrompt, ch.greeting as greeting from conversation c join character ch on ch.id = c.character_id where c.id = ?",
      )
      .get(conversationId) as Record<string, string> | undefined;
    if (!meta) throw new Error(`会話 ${conversationId} がダンプに無い`);
    const turns = db
      .prepare(
        "select content from message where conversation_id = ? and role = 'user' order by created_at, rowid",
      )
      .all(conversationId) as Array<{ content: string }>;
    return {
      id: `replay:${conversationId}`,
      characterName: String(meta.name),
      characterPrompt: String(meta.systemPrompt),
      greeting: String(meta.greeting),
      userTurns: turns.map((t) => t.content).filter((t) => t.trim() !== ""),
    };
  } finally {
    db.close();
  }
}

export type ConversationSummary = {
  conversationId: string;
  characterName: string;
  assistantTurns: number;
  userTurns: number;
};

export function listReplayCandidates(
  sqlPath: string = DEFAULT_DUMP,
  limit = 10,
): ConversationSummary[] {
  const db = openDumpDatabase(sqlPath);
  try {
    return db
      .prepare(
        `select c.id as conversationId, ch.name as characterName,
                sum(case when m.role='assistant' then 1 else 0 end) as assistantTurns,
                sum(case when m.role='user' then 1 else 0 end) as userTurns
           from conversation c
           join character ch on ch.id = c.character_id
           join message m on m.conversation_id = c.id
          group by c.id
          order by assistantTurns desc
          limit ?`,
      )
      .all(limit) as unknown as ConversationSummary[];
  } finally {
    db.close();
  }
}
