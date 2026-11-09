import {
  createDb,
  createD1SummaryStore,
  ensureProactiveConversation,
  loadRecentMemories,
  readDisplayHistory,
  saveProactiveMessage,
} from "@v2/db";
import { createOpenRouterModel } from "@v2/engine";
import { PROMPT_VERSION } from "@v2/prompt";

import { readCharacter } from "./character-data.server";
import { LOCAL_USER_ID } from "./identity";
import { createProviderLookup, resolveProvider, retryProviderLookup } from "./openrouter-lookup";
import { sendProactivePush } from "./push";

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
  now?: () => number;
  // PWA 通知。無い環境では保存だけして終わる。
  push?: (input: {
    characterId: string;
    characterName: string;
    text: string;
    conversationId: string;
  }) => Promise<void>;
  // 実行先の記録用（RIT-100）。invoke の応答 id（gen-…）から provider を引く。
  providerLookup?: (upstreamId: string) => Promise<string | null>;
};

// 一言はモデルの素直な文章をそのまま保存する（ターンの XML 形式は使わん）。
const composeProactiveText = (raw: string): string =>
  raw
    .replace(/<\/?(?:response|action|dialogue|inner|think)[^>]*>/g, "")
    .trim()
    .slice(0, 400);

export const createProactiveSink = (deps: ProactiveSinkDeps): ProactiveNotificationSink => ({
  send: async ({ characterId, idempotencyKey }) => {
    const { ok } = await readCharacter(characterId);
    if (!ok) return;
    const now = deps.now?.() ?? Date.now();
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
      loadRecentMemories(deps.db, conversationId, MEMORY_LIMIT),
      createD1SummaryStore(deps.db).list(conversationId),
    ]);

    const summaryText = [...summaries]
      .sort((a, b) => b.level - a.level || b.coveredTo - a.coveredTo)
      .slice(0, SUMMARY_LIMIT)
      .map((s) => s.text)
      .join("\n");
    const historyText = display.history
      .slice(-HISTORY_TAIL)
      .map((row) => `${row.role === "user" ? "ユーザー" : "あなた"}: ${row.content}`)
      .join("\n");

    const prompt = [
      ok.systemPrompt,
      "",
      "【指示】ユーザーへ自分から話しかける一言を、キャラの口調で書いてください。",
      "前回の話や記憶を自然に踏まえ、1〜3文の短い文にしてください。",
      summaryText ? `これまでのあらすじ:\n${summaryText}` : "",
      memories.length ? `覚えていること:\n${memories.map((m) => `- ${m}`).join("\n")}` : "",
      historyText ? `最近のやり取り:\n${historyText}` : "",
      "",
      "話しかける一言だけを出力してください。",
    ]
      .filter((line) => line !== "")
      .join("\n");

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
    deps
      .push?.({ characterId, characterName: ok.name, text, conversationId })
      .catch((error) =>
        globalThis.console.error(
          JSON.stringify({ event: "proactive_push_failed", errorName: String(error) }),
        ),
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
    db,
    model: createOpenRouterModel({
      OPENROUTER_API_KEY: env.OPENROUTER_API_KEY,
      V2_MODEL: env.V2_MODEL,
      V2_OPENROUTER_BASE_URL: env.V2_OPENROUTER_BASE_URL,
    }),
    providerLookup: (upstreamId) => retryProviderLookup(lookup, upstreamId),
    push: async ({ characterId, characterName, text, conversationId }) => {
      await sendProactivePush(db, env, {
        userId: LOCAL_USER_ID,
        payload: {
          title: characterName,
          body: text,
          url: `/chat/${characterId}?conversationId=${conversationId}`,
          tag: conversationId,
        },
      });
    },
  });
};
