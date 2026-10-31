// WorkerのD1バインディングを共有し、接続元のプロセスに会話を閉じ込めない。
import { FakeListChatModel } from "@langchain/core/utils/testing";
import {
  createD1TurnStore,
  createDb,
  readDisplayHistory,
  readD1StoredTurn,
  type V2Db,
} from "@v2/db";
import {
  contextBudgetFromEnv,
  createOpenRouterModel,
  createTurnGraph,
  runTurn,
  type HistoryMessage,
  type TurnEvent,
  type TurnStore,
} from "@v2/engine";
import { PROMPT_VERSION } from "@v2/prompt";

import { readCharacter } from "./character-data.server";
import { LOCAL_USER_ID } from "./identity";
import { getPlatform } from "./platform";

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

export { LOCAL_USER_ID } from "./identity";

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

// V2_FAKE_MODEL=1 の固定 XML（キー無しのこのコンテナで SSE の配線だけ検証する用）。
const FAKE_RESPONSE =
  "<response><action>小さく笑って、こちらへ一歩近づく。</action><dialogue>ねえ、こっち向いて。</dialogue><inner>ちょっとドキドキしてる。</inner></response>";

const createModel = async (): Promise<BaseChatModel> => {
  // 実行中のWorkerに束縛された設定だけを使い、別プロセスの設定を混ぜない。
  const { env } = await getPlatform();
  if (env.APP_ENV === "test" && env.V2_FAKE_MODEL === "1") {
    return new FakeListChatModel({ responses: [FAKE_RESPONSE], sleep: 5 });
  }
  return createOpenRouterModel({
    OPENROUTER_API_KEY: env.OPENROUTER_API_KEY,
    V2_MODEL: env.V2_MODEL,
  });
};

const getModel = (): Promise<BaseChatModel> => createModel();

const getDb = async (): Promise<V2Db> => {
  const { env } = await getPlatform();
  return createDb(env.DB);
};

// store は (user, character) ごとに作る（v2_conversation の初回 insert に character_id が要る）。
const createStore = (db: V2Db, characterId: string, beforeTurn?: number): TurnStore =>
  createD1TurnStore(db, {
    userId: LOCAL_USER_ID,
    characterId,
    promptVersion: PROMPT_VERSION,
    beforeTurn,
  });

export type StartTurnInput = {
  characterId: string;
  conversationId: string | null;
  text: string;
  expectedTurn?: number;
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
  const model = await getModel();
  const character = await loadValidCharacter(input.characterId);
  const db = await getDb();
  // graph はターンごとに組む。前ターンの状態は intake が D1 から読み直すので checkpointer に
  // 残す必要が無く、character ごとの store を持つ graph をプロセスに溜め込まん方が単純。
  const { env } = await getPlatform();
  const graph = createTurnGraph({
    model,
    contextBudget: contextBudgetFromEnv(env),
    store: createStore(db, input.characterId, input.expectedTurn),
  });
  const conversationId = input.conversationId ?? crypto.randomUUID();
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
  history: (HistoryMessage & { imageUrl?: string })[];
};

// GET /api/chat/:id/history 用。D1 store の load をそのまま返す（再起動をまたいだ永続化の確認口）。
export const loadHistory = async (input: {
  characterId: string;
  conversationId: string;
}): Promise<ConversationHistory> => {
  await loadValidCharacter(input.characterId);
  const db = await getDb();
  const loaded = await createStore(db, input.characterId).load(input.conversationId);
  const rows = await readDisplayHistory(
    db,
    {
      userId: LOCAL_USER_ID,
      characterId: input.characterId,
      promptVersion: PROMPT_VERSION,
    },
    input.conversationId,
  );
  return {
    conversationId: input.conversationId,
    turn: loaded.turn,
    history: rows.map((row) => ({
      role: row.role,
      content: row.content,
      ...(row.imageKey ? { imageUrl: `/api/media/${encodeURIComponent(row.id)}` } : {}),
    })),
  };
};

export const loadStoredTurn = async (characterId: string, conversationId: string, turn: number) =>
  readD1StoredTurn(
    await getDb(),
    { userId: LOCAL_USER_ID, characterId, promptVersion: PROMPT_VERSION },
    conversationId,
    turn,
  );
