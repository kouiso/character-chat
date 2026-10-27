// @v2/engine の LangGraph（intake→…→persist）へ、ローカル D1（getPlatform().env.DB）を
// TurnStore として差して 1 ターンを流す。会話履歴は v2_* テーブルに残るので
// プロセス再起動をまたいで続く（M1）。V2_FAKE_MODEL=1 は model だけ固定 XML に置き換え、
// store は同じ D1 版を使う（配線の検証が本番と同じ保存経路を通るように）。
import {
  createD1TurnStore,
  createDb,
  createModelAttemptRecorder,
  loadChunkDeliveries,
  type ChunkDelivery,
  type V2Db,
  TurnCommitConflictError,
  v2ConversationTable,
  v2GenerationTable,
  v2MessageTable,
} from "@v2/db";
import {
  createTurnGraph,
  runTurn,
  type HistoryMessage,
  type TurnEvent,
  type TurnStore,
} from "@v2/engine";
import { PROMPT_VERSION } from "@v2/prompt";
import { and, eq } from "drizzle-orm";

import { readCharacter } from "./characters";
import { loadConversationMessages, loadConversationSnapshot } from "./conversation-data";
import { createRuntimeModel } from "./model";
import { getPlatform } from "./platform";
import { readStoredReplyEvents, StoredReplyConflictError } from "./stored-reply";

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

// 個人用BASIC認証を通った利用者を、資格情報の変更に依存しない内部IDへ対応づける。
export const LOCAL_USER_ID = "local";

export class ConversationNotFoundError extends Error {
  constructor() {
    super("conversation が見つかりません");
    this.name = "ConversationNotFoundError";
  }
}

export class CharacterNotFoundError extends Error {
  constructor(id: string) {
    super(`character が見つからん: ${id}`);
    this.name = "CharacterNotFoundError";
  }
}

// character 行はあるが zod（@v2/db の loadCharacter）を通らん。404 と分けて 422 に写す。
export class CharacterInvalidError extends Error {
  readonly failures: readonly unknown[];
  constructor(id: string, failures: readonly unknown[]) {
    super(`character の設定が不正: ${id}`);
    this.name = "CharacterInvalidError";
    this.failures = failures;
  }
}

const createModel = async (
  db: V2Db,
  characterId: string,
  conversationId: string,
  runId: string,
): Promise<BaseChatModel> => {
  const { env } = await getPlatform();
  // 監査の所有範囲を別turnと共有しないため、modelもturnごとに組む。
  return createRuntimeModel(env, {
    onAttempt: createModelAttemptRecorder(db, {
      userId: LOCAL_USER_ID,
      characterId,
      conversationId,
      runId: `${runId}:${crypto.randomUUID()}`,
    }),
  });
};

const getDb = async (): Promise<V2Db> => {
  const { env } = await getPlatform();
  return createDb(env.DB);
};

// store は (user, character) ごとに作る（v2_conversation の初回 insert に character_id が要る）。
const createStore = (db: V2Db, characterId: string): TurnStore =>
  createD1TurnStore(db, {
    userId: LOCAL_USER_ID,
    characterId,
    promptVersion: PROMPT_VERSION,
  });

export type StartTurnInput = {
  characterId: string;
  conversationId: string | null;
  text: string;
  expectedTurn?: number;
  generationId?: string;
};

const loadValidCharacter = async (characterId: string) => {
  const { ok, failures } = await readCharacter(characterId);
  if (ok) return ok;
  if (failures.length > 0) throw new CharacterInvalidError(characterId, failures);
  throw new CharacterNotFoundError(characterId);
};

// キー未設定・character 不在はストリームを開く前に throw して、呼び出し側が
// ステータスコード（503/404/422）を確定できるようにする。
export const startTurn = async (
  input: StartTurnInput,
): Promise<{ conversationId: string; events: AsyncGenerator<TurnEvent> }> => {
  const character = await loadValidCharacter(input.characterId);
  const db = await getDb();
  const conversationId = input.conversationId ?? crypto.randomUUID();
  const store = createStore(db, input.characterId);
  const loaded = await store.load(conversationId);
  const expectedTurn = input.expectedTurn ?? loaded.turn;
  if (loaded.turn !== expectedTurn) throw new TurnCommitConflictError();
  const writeId = input.generationId ?? crypto.randomUUID();
  const model = await createModel(db, input.characterId, conversationId, writeId);
  // graph はターンごとに組む。前ターンの状態は intake が D1 から読み直すので checkpointer に
  // 残す必要が無く、character ごとの store を持つ graph をプロセスに溜め込まん方が単純。
  const graph = createTurnGraph({
    model,
    id: () => writeId,
    store: {
      load: (id) => store.load(id),
      saveTurn: (turn) => store.saveTurn({ ...turn, commit: { expectedTurn, writeId } }),
    },
  });
  const events = runTurn(
    graph,
    { conversationId, userText: input.text, character },
    conversationId,
  );
  return { conversationId, events };
};

export type ConversationHistory = {
  conversationId: string;
  // 次に保存されるターン番号（= 保存済みターン数 + 1）。
  turn: number;
  history: (HistoryMessage & { turn?: number })[];
  deliveries: ChunkDelivery[];
};

// GET /api/chat/:id/history 用。D1 store の load をそのまま返す（再起動をまたいだ永続化の確認口）。
export const loadHistory = async (input: {
  characterId: string;
  conversationId: string;
}): Promise<ConversationHistory> => {
  await loadValidCharacter(input.characterId);
  const db = await getDb();
  const snapshot = await loadConversationSnapshot(db, {
    conversationId: input.conversationId,
    characterId: input.characterId,
    userId: LOCAL_USER_ID,
  });
  if (!snapshot) throw new ConversationNotFoundError();
  return snapshot;
};

export const loadRoomHistory = async (input: { characterId: string; conversationId: string }) => {
  await loadValidCharacter(input.characterId);
  const loaded = await createStore(await getDb(), input.characterId).load(input.conversationId);
  return { conversationId: input.conversationId, turn: loaded.turn, history: loaded.history };
};

export const loadStoredTurn = async (characterId: string, conversationId: string, turn: number) => {
  const db = await getDb();
  await createStore(db, characterId).load(conversationId);
  return loadConversationMessages(db, { userId: LOCAL_USER_ID, characterId, conversationId }, turn);
};

export const loadStoredReply = async (
  characterId: string,
  conversationId: string,
  turn: number,
) => {
  const db = await getDb();
  await createStore(db, characterId).load(conversationId);
  const deliveries = await loadChunkDeliveries(db, {
    userId: LOCAL_USER_ID,
    characterId,
    conversationId,
  });
  const delivery = deliveries?.find((item) => item.turn === turn);
  if (!delivery) return null;
  const [generation] = await db
    .select({
      id: v2GenerationTable.id,
      status: v2GenerationTable.status,
      error: v2GenerationTable.error,
    })
    .from(v2GenerationTable)
    .innerJoin(v2MessageTable, eq(v2MessageTable.generationId, v2GenerationTable.id))
    .innerJoin(v2ConversationTable, eq(v2ConversationTable.id, v2MessageTable.conversationId))
    .where(
      and(
        eq(v2ConversationTable.id, conversationId),
        eq(v2ConversationTable.userId, LOCAL_USER_ID),
        eq(v2ConversationTable.characterId, characterId),
        eq(v2MessageTable.turn, turn),
        eq(v2MessageTable.role, "assistant"),
      ),
    )
    .limit(1);
  if (!generation) return null;
  if (delivery.generationId !== generation.id)
    throw new StoredReplyConflictError("saved delivery generation mismatch");
  const { env } = await getPlatform();
  const savedEvents = await readStoredReplyEvents(env.DB, conversationId, turn, generation.id);
  const events = delivery.chunks.map((chunk) => {
    const saved = savedEvents.find((event) => event.type === "chunk" && event.seq === chunk.seq);
    if (!saved || saved.type !== "chunk")
      throw new StoredReplyConflictError("saved delivery chunk missing");
    return { ...saved, text: chunk.text, scheduledAt: chunk.scheduledAt };
  });
  return { ...generation, events, delivery };
};
