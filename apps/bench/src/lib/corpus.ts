import { openDumpDatabase } from "./sqlite.ts";

// 既存の D1 バックアップ(.sql)を読むためだけの層。本番 D1 には一切繋がへん。

export type CorpusMessage = {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  createdAt: number;
};

export type Corpus = {
  messages: CorpusMessage[];
  conversations: Map<string, CorpusMessage[]>;
};

export function loadCorpusFromDump(sqlPath: string): Corpus {
  const db = openDumpDatabase(sqlPath);
  const rows = db
    .prepare(
      "select id, conversation_id, role, content, created_at from message order by conversation_id, created_at, rowid",
    )
    .all() as Array<Record<string, string | number>>;
  db.close();

  const messages: CorpusMessage[] = rows.map((r) => ({
    id: String(r.id),
    conversationId: String(r.conversation_id),
    role: String(r.role),
    content: String(r.content ?? ""),
    createdAt: Number(r.created_at),
  }));

  const conversations = new Map<string, CorpusMessage[]>();
  for (const m of messages) {
    const list = conversations.get(m.conversationId);
    if (list) list.push(m);
    else conversations.set(m.conversationId, [m]);
  }
  return { messages, conversations };
}
