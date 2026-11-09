// POST /api/admin/legacy-migration — 旧 memory_note/rag_chunk を v2 の記憶・検索箱へ移す（RIT-78）。
// Basic 認証の内側なので追加の認可は持たん。dryRun: true で件数だけ返す。
import {
  createDb,
  LegacyMigrationError,
  listLegacyConversationUserIds,
  listLegacyMemoryUserIds,
  migrateLegacyConversations,
} from "@v2/db";
import { z } from "zod";

import { LOCAL_USER_ID } from "./identity";
import {
  indexCorpusChunks,
  runLegacyMemoryMigration,
  type LegacyMigrationRunReport,
} from "./legacy-memory-migration";
import { getPlatform } from "./platform";

const BodySchema = z.object({
  sourceUserId: z.string().min(1).optional(),
  targetUserId: z.string().min(1).optional(),
  characterId: z.string().min(1).optional(),
  dryRun: z.boolean().optional(),
  corpus: z.boolean().optional(),
  conversations: z.boolean().optional(),
});

type ConversationMigrationInput = { sourceUserId?: string; dryRun?: boolean };

const runConversationMigration = async (
  db: ReturnType<typeof createDb>,
  input: ConversationMigrationInput,
  targetUserId: string,
) => {
  const sourceUserIds = input.sourceUserId
    ? [input.sourceUserId]
    : await listLegacyConversationUserIds(db);
  const outcomes = [];
  for (const sourceUserId of sourceUserIds) {
    const outcome = await migrateLegacyConversations(db, {
      sourceUserId,
      targetUserId,
      dryRun: input.dryRun,
    }).catch((error: unknown) => {
      if (error instanceof LegacyMigrationError) return error;
      throw error;
    });
    outcomes.push(
      outcome instanceof LegacyMigrationError
        ? { sourceUserId, ...outcome.result, failures: outcome.failures }
        : { sourceUserId, ...outcome },
    );
  }
  return outcomes;
};

export const handleLegacyMigration = async (request: Request): Promise<Response> => {
  if (request.method !== "POST") {
    return Response.json({ message: "POST で呼んでください。" }, { status: 405 });
  }
  let payload: unknown = {};
  const text = await request.text();
  if (text.trim() !== "") {
    try {
      payload = JSON.parse(text);
    } catch {
      return Response.json({ message: "JSON形式で送信してください。" }, { status: 400 });
    }
  }
  const parsed = BodySchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ message: "送信内容を確認してください。" }, { status: 400 });
  }
  const { env } = await getPlatform();
  const db = createDb(env.DB);
  const targetUserId = parsed.data.targetUserId ?? LOCAL_USER_ID;

  const sourceUserIds = parsed.data.sourceUserId
    ? [parsed.data.sourceUserId]
    : await listLegacyMemoryUserIds(db);

  const reports: { sourceUserId: string; report: LegacyMigrationRunReport }[] = [];
  for (const sourceUserId of sourceUserIds) {
    reports.push({
      sourceUserId,
      report: await runLegacyMemoryMigration(db, env, {
        sourceUserId,
        targetUserId,
        characterId: parsed.data.characterId,
        dryRun: parsed.data.dryRun,
      }),
    });
  }
  // corpus（rag_chunk 共有コーパス）はユーザー単位ではなく1回だけ。memory_note が
  // 0 件の環境でも実行できるよう reports の外で回す。
  const corpus = parsed.data.corpus ? await indexCorpusChunks(db, env, parsed.data.dryRun) : null;
  // 会話移行（RIT-45）。memory_note の利用者とは別の集合を使う。
  const conversations = parsed.data.conversations
    ? await runConversationMigration(db, parsed.data, targetUserId)
    : null;
  return Response.json({ targetUserId, reports, corpus, conversations });
};
