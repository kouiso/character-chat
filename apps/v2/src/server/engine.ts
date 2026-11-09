// WorkerのD1バインディングを共有し、接続元のプロセスに会話を閉じ込めない。
import { FakeListChatModel } from "@langchain/core/utils/testing";
import {
  composeSystemPrompt,
  createD1SummaryStore,
  createD1TurnStore,
  createDb,
  ensureConversationVersion,
  ensureCurrentVersion,
  loadVersionedCharacter,
  readDisplayHistory,
  readD1StoredTurn,
  updateGenerationProvider,
  type CharacterContent,
  type CharacterSheet,
  type V2Db,
} from "@v2/db";
import {
  contextBudgetFromEnv,
  createModelChain,
  createTurnGraph,
  runTurn,
  type HistoryMessage,
  type ModelCandidate,
  type TurnEvent,
  type TurnStore,
} from "@v2/engine";
import { PROMPT_VERSION } from "@v2/prompt";

import { readCharacter } from "./character-data.server";
import { retrieveDocumentChunks } from "./document-rag";
import { LOCAL_USER_ID } from "./identity";
import { retrieveMemories } from "./memory-rag";
import { memoryVectorReady } from "./memory-vector";
import { createProviderLookup, retryProviderLookup } from "./openrouter-lookup";
import { readPlan } from "./plan";
import { getPlatform } from "./platform";
import { readSafeMode } from "./user-settings";

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

// RIT-102/104: 拒否・時間切れ・障害で順に落ちる逃げ道チェーン。
// 単モデル指定（V2_MODEL・V2_FAKE_MODEL）の時は 1 本だけの列になる。
const createModels = async (safeMode: boolean): Promise<ModelCandidate[]> => {
  // 実行中のWorkerに束縛された設定だけを使い、別プロセスの設定を混ぜない。
  const { env } = await getPlatform();
  if (env.APP_ENV === "test" && env.V2_FAKE_MODEL === "1") {
    return [
      { name: "fake", model: new FakeListChatModel({ responses: [FAKE_RESPONSE], sleep: 5 }) },
    ];
  }
  return createModelChain(
    {
      OPENROUTER_API_KEY: env.OPENROUTER_API_KEY,
      V2_MODEL: env.V2_MODEL,
      V2_OPENROUTER_BASE_URL: env.V2_OPENROUTER_BASE_URL,
      V2_MODEL_CHAIN: env.V2_MODEL_CHAIN,
      V2_SAFE_MODEL_CHAIN: env.V2_SAFE_MODEL_CHAIN,
    },
    { safeMode },
  );
};

const getModels = (safeMode: boolean): Promise<ModelCandidate[]> => createModels(safeMode);

// V2_TURN_TIMEOUT_MS が数字なら採用、それ以外（未設定・壊れ）は既定のまま。
const turnTimeoutFromEnv = (env: { V2_TURN_TIMEOUT_MS?: string }): number | undefined => {
  const parsed = Number(env.V2_TURN_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const getDb = async (): Promise<V2Db> => {
  const { env } = await getPlatform();
  return createDb(env.DB);
};

// store は (user, character) ごとに作る（v2_conversation の初回 insert に character_id が要る）。
const createStore = (
  db: V2Db,
  characterId: string,
  beforeTurn?: number,
  characterVersionId?: string,
  extractMemory = false,
  branch = false,
): TurnStore =>
  createD1TurnStore(db, {
    userId: LOCAL_USER_ID,
    characterId,
    promptVersion: PROMPT_VERSION,
    beforeTurn,
    characterVersionId,
    extractMemory,
    branch,
  });

export type StartTurnInput = {
  characterId: string;
  conversationId: string | null;
  text: string;
  expectedTurn?: number;
  // 実行先の遅延解決用（RIT-100）。呼び出し側の ExecutionContext.waitUntil を渡すと、
  // /generation の索引待ちをターン完了の後ろへ回せる。未指定なら未解決のまま残る。
  waitUntil?: (promise: Promise<unknown>) => void;
  // RIT-202 再生成: true の時 assistant 行を同じターンの新しい枝として保存する。
  // expectedTurn は必須（再生成するターン）。
  branch?: boolean;
};

const loadValidCharacter = async (characterId: string) => {
  const { ok, failures } = await readCharacter(characterId);
  if (ok) return ok;
  if (failures.length > 0) throw new CharacterInvalidError(characterId, failures);
  throw new CharacterNotFoundError(characterId);
};

// 版の content を CharacterSheet へ写す。版に無い表示用の列（gender・表示順等）は
// character 行の値をそのまま使う。systemPrompt は保存しない派生値なので毎回ここで合成する。
const applyCharacterVersion = (
  sheet: CharacterSheet,
  content: CharacterContent,
): CharacterSheet => ({
  ...sheet,
  name: content.name,
  systemPrompt: composeSystemPrompt(content),
  greeting: content.greeting,
  tags: content.tags,
  avatar: content.avatarRef,
});

// 会話が固定した版のキャラを返す。旧会話も最初のターン前に現在版を固定する。
const resolveConversationCharacter = async (
  db: V2Db,
  input: { characterId: string; conversationId: string | null },
): Promise<{ character: CharacterSheet; versionId: string | null }> => {
  const sheet = await loadValidCharacter(input.characterId);
  const ensured = await ensureCurrentVersion(db, input.characterId, LOCAL_USER_ID);
  if (!ensured) throw new CharacterNotFoundError(input.characterId);
  const versionId = input.conversationId
    ? await ensureConversationVersion(db, {
        conversationId: input.conversationId,
        userId: LOCAL_USER_ID,
        characterId: input.characterId,
        promptVersion: PROMPT_VERSION,
        versionId: ensured.versionId,
      })
    : ensured.versionId;
  const version = await loadVersionedCharacter(db, {
    versionId,
    characterId: input.characterId,
    userId: LOCAL_USER_ID,
  });
  if (!version) throw new CharacterNotFoundError(input.characterId);
  return { character: applyCharacterVersion(sheet, version.content), versionId };
};

// キー未設定・character 不在はストリームを開く前に throw して、呼び出し側が
// ステータスコード（503/404/422）を確定できるようにする。
export const startTurn = async (
  input: StartTurnInput,
): Promise<{ conversationId: string; events: AsyncGenerator<TurnEvent> }> => {
  // セーフモードはターン開始時の設定で決める（切替は次ターンから効く・RIT-199）。
  const { env: modelEnv } = await getPlatform();
  const safeMode = modelEnv.DB ? await readSafeMode(modelEnv.DB, LOCAL_USER_ID) : false;
  const models = await getModels(safeMode);
  const db = await getDb();
  const conversationId = input.conversationId ?? crypto.randomUUID();
  const { character, versionId } = await resolveConversationCharacter(db, {
    characterId: input.characterId,
    conversationId,
  });
  // graph はターンごとに組む。前ターンの状態は intake が D1 から読み直すので checkpointer に
  // 残す必要が無く、character ごとの store を持つ graph をプロセスに溜め込まん方が単純。
  const { env } = await getPlatform();
  const graph = createTurnGraph({
    model: models[0].model,
    models,
    contextBudget: contextBudgetFromEnv(env),
    retrieveMemories: memoryVectorReady(env)
      ? async (targetConversationId, query) =>
          retrieveMemories(
            db,
            env,
            {
              userId: LOCAL_USER_ID,
              characterId: input.characterId,
              conversationId: targetConversationId,
              beforeTurn: input.expectedTurn,
              // 記憶検索の深さは保有プランの機能差（RIT-193）。検索時点の段階を見る。
              topK: (await readPlan(env.DB, LOCAL_USER_ID)).features.memoryTopK,
            },
            query,
          )
      : undefined,
    retrieveDocuments: memoryVectorReady(env)
      ? (query) =>
          retrieveDocumentChunks(
            db,
            env,
            { userId: LOCAL_USER_ID, characterId: input.characterId },
            query,
          ).then((entries) =>
            entries.map((entry) => ({
              id: entry.documentId,
              content: `【${entry.title}】${entry.content}`,
            })),
          )
      : undefined,
    store: createStore(
      db,
      input.characterId,
      input.expectedTurn,
      versionId ?? undefined,
      Boolean(env.MEMORY_QUEUE),
      input.branch === true,
    ),
    summaryStore: createD1SummaryStore(db),
    providerLookup: createProviderLookup(env),
    // 索引待ちの引き直しはターン完了の後ろへ。引けたら generation 行を UPDATE する。
    onProviderUnresolved: input.waitUntil
      ? (generationId, upstreamId) =>
          input.waitUntil?.(
            (async () => {
              const provider = await retryProviderLookup(createProviderLookup(env), upstreamId);
              if (provider) await updateGenerationProvider(db, generationId, provider);
            })(),
          )
      : undefined,
  });
  const events = runTurn(
    graph,
    {
      conversationId,
      userText: input.text,
      character,
      // RIT-102: 1 ターンの締切を設定へ持つ。値は v2_generation.timeout_ms へ記録される。
      ...(turnTimeoutFromEnv(env) ? { timeoutMs: turnTimeoutFromEnv(env) } : {}),
    },
    conversationId,
  );
  return { conversationId, events };
};

export type ConversationHistory = {
  conversationId: string;
  // 次に保存されるターン番号（= 保存済みターン数 + 1）。
  turn: number;
  history: (HistoryMessage & {
    id: string;
    turn: number;
    imageUrl?: string;
    mediaKind?: "image" | "video";
  })[];
};

// GET /api/chat/:id/history と ChatRoom の job.turn の両方がここを読む。履歴と次の番号は
// readDisplayHistory の 1 回の読込から作り、失敗ターンの扱いを engine の load と揃える。
export const loadHistory = async (input: {
  characterId: string;
  conversationId: string;
}): Promise<ConversationHistory> => {
  await loadValidCharacter(input.characterId);
  const db = await getDb();
  const display = await readDisplayHistory(
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
    turn: display.turn,
    history: display.history.map((row) => ({
      id: row.id,
      turn: row.turn,
      role: row.role,
      content: row.content,
      ...(row.imageKey
        ? {
            imageUrl: `/api/media/${encodeURIComponent(row.id)}`,
            // 動画メッセージ（RIT-190）は mp4 キーを持つ。バブル側で video 要素に分ける。
            mediaKind: row.imageKey.endsWith(".mp4") ? ("video" as const) : ("image" as const),
          }
        : {}),
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
