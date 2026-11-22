import {
  createDb,
  describeError,
  createD1SummaryStore,
  ensureProactiveConversation,
  loadRecentMemories,
  readDisplayHistory,
  saveProactiveMessage,
} from "@v2/db";
import { createOpenRouterModel, visibleSummaries } from "@v2/engine";
import { PROMPT_VERSION } from "@v2/prompt";

import { readCharacter } from "./character-data.server";
import { LOCAL_USER_ID } from "./identity";
import { createProviderLookup, resolveProvider, retryProviderLookup } from "./openrouter-lookup";
import { findRecallCue, recallCueLead, type RecallCue } from "./proactive-recall";
import { reportFailure } from "./log";
import { proactivePushPayloadFor, sendProactivePush } from "./push";
import { readNotificationSettings } from "./user-settings";

import type { ProactiveNotificationSink } from "./proactive-notification-store";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { V2Db } from "@v2/db";

const HISTORY_TAIL = 8;
const MEMORY_LIMIT = 8;
const SUMMARY_LIMIT = 4;

// sink.send は model 呼出しと D1 書込みを伴うので、差し替え口を env ではなく引数で渡す。
export type ProactiveSinkDeps = {
  model: BaseChatModel;
  db: V2Db;
  // 記憶キュー判定（RIT-198）は生 D1 を使う。無い環境では recall は送らん。
  d1?: D1Database;
  now?: () => number;
  // PWA 通知。無い環境では保存だけして終わる。
  push?: (input: {
    characterId: string;
    characterName: string;
    text: string;
    conversationId: string;
  }) => Promise<void>;
  // 失敗の記録と知らせの束ね（RIT-66）。試験が deps だけで組む時は省略される。
  env?: unknown;
  // 実行先の記録用（RIT-100）。invoke の応答 id（gen-…）から provider を引く。
  providerLookup?: (upstreamId: string) => Promise<string | null>;
};

// 一言はモデルの素直な文章をそのまま保存する（ターンの XML 形式は使わん）。
const composeProactiveText = (raw: string): string =>
  raw
    .replace(/<\/?(?:response|action|dialogue|inner|think)[^>]*>/g, "")
    .trim()
    .slice(0, 400);

// recall は発火から保存までの間にキューが消えることもある。その場合は送らん
// （想起発話は必ず該当記憶を参照することが受入条件）。
const recallCueFor = async (
  deps: ProactiveSinkDeps,
  characterId: string,
  trigger: "idle" | "recall" | undefined,
  now: number,
): Promise<RecallCue | null> =>
  trigger === "recall" && deps.d1
    ? findRecallCue(deps.d1, { userId: LOCAL_USER_ID, characterId, now })
    : null;

const buildPrompt = (input: {
  systemPrompt: string;
  cue: RecallCue | null;
  summaries: { level: number; toTurn: number; text: string }[];
  memories: string[];
  history: { role: string; content: string }[];
}): string => {
  const summaryText = [...input.summaries]
    .sort((a, b) => b.level - a.level || b.toTurn - a.toTurn)
    .slice(0, SUMMARY_LIMIT)
    .map((s) => s.text)
    .join("\n");
  const historyText = input.history
    .slice(-HISTORY_TAIL)
    .map((row) => `${row.role === "user" ? "ユーザー" : "あなた"}: ${row.content}`)
    .join("\n");
  return [
    input.systemPrompt,
    "",
    "【指示】ユーザーへ自分から話しかける一言を、キャラの口調で書いてください。",
    "前回の話や記憶を自然に踏まえ、1〜3文の短い文にしてください。",
    input.cue
      ? `${recallCueLead(input.cue)}\n- ${input.cue.content}\nこの思い出に触れて話しかけてください。`
      : "",
    summaryText ? `これまでのあらすじ:\n${summaryText}` : "",
    input.memories.length
      ? `覚えていること:\n${input.memories.map((m) => `- ${m}`).join("\n")}`
      : "",
    historyText ? `最近のやり取り:\n${historyText}` : "",
    "",
    "話しかける一言だけを出力してください。",
  ]
    .filter((line) => line !== "")
    .join("\n");
};

export const createProactiveSink = (deps: ProactiveSinkDeps): ProactiveNotificationSink => ({
  // recall トリガは記憶キューがある時だけ送る（RIT-198）。idle は従来どおり。
  preflight: async ({ characterId, trigger }) => {
    if (trigger !== "recall") return "send";
    const cue = await recallCueFor(deps, characterId, trigger, deps.now?.() ?? Date.now());
    return cue ? "send" : "skip";
  },
  send: async ({ characterId, idempotencyKey, trigger }) => {
    const { ok } = await readCharacter(characterId);
    if (!ok) return;
    const now = deps.now?.() ?? Date.now();
    const cue = await recallCueFor(deps, characterId, trigger, now);
    if (trigger === "recall" && !cue) return;
    const conversationId = await ensureProactiveConversation(deps.db, {
      userId: LOCAL_USER_ID,
      characterId,
      promptVersion: PROMPT_VERSION,
      now,
    });

    const [display, memories, summaries] = await Promise.all([
      readDisplayHistory(
        deps.db,
        { userId: LOCAL_USER_ID, characterId, promptVersion: PROMPT_VERSION },
        conversationId,
      ),
      loadRecentMemories(
        deps.db,
        { userId: LOCAL_USER_ID, characterId, conversationId },
        MEMORY_LIMIT,
      ),
      // 指示文と同じ選び方（最新の level 2 + 未収載の level 1）で絞る。
      // listActive の生の行は伏せ直し待ちや古い level 2 も混ざる。
      createD1SummaryStore(deps.db).listActive(conversationId).then(visibleSummaries),
    ]);
    const prompt = buildPrompt({
      systemPrompt: ok.systemPrompt,
      cue,
      summaries,
      memories,
      history: display.history,
    });

    const response = await deps.model.invoke([{ role: "user", content: prompt }]);
    const text = composeProactiveText(typeof response.content === "string" ? response.content : "");
    if (!text) return;

    const { provider, upstreamId } = await resolveProvider(response.id, deps.providerLookup);

    await saveProactiveMessage(deps.db, {
      conversationId,
      text,
      idempotencyKey,
      provider,
      upstreamId,
      now,
    });

    // 通知は保存が済んでから。失敗しても本文は消えんので投げっぱでOK。
    deps.push?.({ characterId, characterName: ok.name, text, conversationId }).catch((error) =>
      reportFailure(deps.env, {
        event: "proactive_push_failed",
        level: "error",
        reason: describeError(error),
      }),
    );
  },
});

export const createEnvProactiveSink = async (env: {
  DB: Parameters<typeof createDb>[0];
  OPENROUTER_API_KEY?: string;
  V2_MODEL?: string;
  V2_OPENROUTER_BASE_URL?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}): Promise<ProactiveNotificationSink> => {
  const db = createDb(env.DB);
  // 話しかけは alarm の中で走るので応答を待つ者はおらん。/generation の索引が
  // 乗るまでその場で粘ってから 1 行で保存する（即時 lookup だとほぼ必ず unknown になる）。
  const lookup = createProviderLookup(env);
  return createProactiveSink({
    env,
    db,
    d1: env.DB,
    model: createOpenRouterModel({
      OPENROUTER_API_KEY: env.OPENROUTER_API_KEY,
      V2_MODEL: env.V2_MODEL,
      V2_OPENROUTER_BASE_URL: env.V2_OPENROUTER_BASE_URL,
    }),
    providerLookup: (upstreamId) => retryProviderLookup(lookup, upstreamId),
    push: async ({ characterId, characterName, text, conversationId }) => {
      // 「通知の設定」の正本は v2_user_settings。受け取る・話しかけが切れている時は
      // メッセージの保存だけ残して push は送らん（文を隠す時は汎用文になる）。
      const notify = await readNotificationSettings(env.DB, LOCAL_USER_ID);
      const payload = proactivePushPayloadFor(notify, { characterName, text });
      if (!payload) return;
      await sendProactivePush(db, env, {
        userId: LOCAL_USER_ID,
        payload: {
          ...payload,
          url: `/chat/${characterId}?conversationId=${conversationId}`,
          tag: conversationId,
        },
      });
    },
  });
};
