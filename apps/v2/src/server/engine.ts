// @v2/engine の LangGraph（intake→…→persist）へ、ローカル D1（getPlatform().env.DB）を
// TurnStore として差して 1 ターンを流す。会話履歴は v2_* テーブルに残るので
// プロセス再起動をまたいで続く（M1）。V2_FAKE_MODEL=1 は model だけ固定 XML に置き換え、
// store は同じ D1 版を使う（配線の検証が本番と同じ保存経路を通るように）。
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { createD1TurnStore, createDb, type V2Db } from "@v2/db";
import {
  createOpenRouterModel,
  createTurnGraph,
  runTurn,
  type HistoryMessage,
  type TurnEvent,
  type TurnStore,
} from "@v2/engine";
import { PROMPT_VERSION } from "@v2/prompt";

import { readCharacter } from "./characters";
import { getPlatform } from "./platform";

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

// M1 は認証を持たんので、全会話をこの 1 ユーザーに紐づける（v2_conversation.user_id）。
// 認証が入った時にここを request 由来の id へ差し替えるだけで済むよう、参照を 1 箇所に集める。
export const LOCAL_USER_ID = "local";

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

const isFakeModel = (): boolean => process.env.V2_FAKE_MODEL === "1";

const createModel = async (): Promise<BaseChatModel> => {
  if (isFakeModel()) return new FakeListChatModel({ responses: [FAKE_RESPONSE] });
  // キーは apps/v2/.dev.vars（wrangler が env に載せる）を第一に、シェルの環境変数も受ける。
  const { env } = await getPlatform();
  return createOpenRouterModel({
    OPENROUTER_API_KEY: env.OPENROUTER_API_KEY ?? process.env.OPENROUTER_API_KEY,
    V2_MODEL: env.V2_MODEL ?? process.env.V2_MODEL,
  });
};

const MODEL_KEY = Symbol.for("adult-ai-v2.chat-model");
type ModelHolder = { [MODEL_KEY]?: Promise<BaseChatModel> };

// platform.ts と同じ理由で globalThis にキャッシュする（HMR で二重に組まん）。
// キー未設定は createModel が投げるので、失敗した Promise はキャッシュに残さん
// （.dev.vars を置いた後、再起動せずに次のリクエストで復帰できるように）。
const getModel = (): Promise<BaseChatModel> => {
  const holder = globalThis as ModelHolder;
  holder[MODEL_KEY] ??= createModel().catch((error: unknown) => {
    delete holder[MODEL_KEY];
    throw error;
  });
  return holder[MODEL_KEY];
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
  const graph = createTurnGraph({ model, store: createStore(db, input.characterId) });
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
  history: HistoryMessage[];
};

// GET /api/chat/:id/history 用。D1 store の load をそのまま返す（再起動をまたいだ永続化の確認口）。
export const loadHistory = async (input: {
  characterId: string;
  conversationId: string;
}): Promise<ConversationHistory> => {
  await loadValidCharacter(input.characterId);
  const db = await getDb();
  const loaded = await createStore(db, input.characterId).load(input.conversationId);
  return { conversationId: input.conversationId, turn: loaded.turn, history: loaded.history };
};
