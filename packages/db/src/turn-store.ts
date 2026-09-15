// TurnStore の契約と、その D1 実装（v2_* テーブル）。
// 契約をここ（@v2/db）に置くのは、@v2/engine が package.json で @v2/db に依存しとるため。
// engine 側で定義すると db → engine → db の循環になる。engine は型を再 export して使う。
import { emptyLedger, type SceneLedger } from "@v2/prompt";
import { asc, desc, eq, and, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import {
  v2ChunkTable,
  v2ConversationTable,
  v2GenerationTable,
  v2LedgerTable,
  v2MessageTable,
} from "./v2-schema";

import type { V2Db } from "./client";
import type { JudgeResult } from "@v2/judge";

export type HistoryMessage = { role: "user" | "assistant"; content: string };

// v2_generation 1 行分。engine の generate ノードが 1 回の生成ごとに作り、persist が events の
// 先頭に "generation" イベントとして載せる（SSE には流さん）。
export type GenerationRecord = {
  generationId: string;
  model: string;
  promptVersion: string;
  systemPrompt: string;
  // 送った messages[]（system は含まん。system は systemPrompt）。
  request: HistoryMessage[];
  rawOutput: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number } | null;
  latencyMs: number;
  // "aborted" は engine 側が request を止めた時（受信字数の上限か締切）。理由は truncated に載る。
  status: "ok" | "error" | "aborted";
  error?: string;
  // 1 ターンの上限で切った生成。chars = 受け取った生の字数が上限を超えた、deadline = 締切（timeoutMs）。
  truncated?: "chars" | "deadline";
};

export type TurnEvent =
  | { type: "token"; text: string }
  | { type: "chunk"; seq: number; text: string; judge: JudgeResult; attempt: number }
  // 判定で 2 回落ちて配らんことにした塊。本文には出さず、監視と transcript の数字にだけ使う。
  | { type: "dropped"; seq: number; reasons: string[]; attempt: number }
  | ({ type: "generation" } & GenerationRecord)
  // ターンの観測値だけを SSE へ流す。generation 本体は systemPrompt と request 丸ごとを抱えとるので
  // 配信に載せられん（engine テストが not.toContain("generation") で固定しとる）。ベンチが要るのは
  // 「字数不足で書き足しを食らったか」「打ち切られたか」だけなので、その 2 つを別の軽い事象で出す。
  | { type: "turn-meta"; extended: number; truncated: "chars" | "deadline" | null; model: string; latencyMs: number }
  | { type: "done"; conversationId: string; turn: number; generationId: string | null }
  | { type: "error"; message: string };

export type TurnStoreLoaded = { history: HistoryMessage[]; ledger: SceneLedger; turn: number };

export type SaveTurnInput = {
  conversationId: string;
  turn: number;
  userText: string;
  events: TurnEvent[];
  ledger: SceneLedger;
  // LangGraph の thread_id。engine が渡さん場合は conversationId と同じ値で保存する。
  threadId?: string;
};

// load() が返す turn は「次に演じるターン番号」（graph.ts の intake がそのまま state.turn に入れ、
// persist が同じ値で saveTurn する）。空の会話は 1。createMemoryTurnStore と同じ意味。
export type TurnStore = {
  load: (conversationId: string) => Promise<TurnStoreLoaded>;
  saveTurn: (input: SaveTurnInput) => Promise<void>;
};

export type D1TurnStoreOptions = {
  userId: string;
  characterId: string;
  promptVersion: string;
};

type ChunkEvent = Extract<TurnEvent, { type: "chunk" }>;
type GenerationEvent = Extract<TurnEvent, { type: "generation" }>;

const isChunkEvent = (event: TurnEvent): event is ChunkEvent => event.type === "chunk";
const isGenerationEvent = (event: TurnEvent): event is GenerationEvent =>
  event.type === "generation";

// createMemoryTurnStore と同じ結合（chunk を seq 順に空行で繋ぐ）。履歴として model に戻す本文。
const assistantTextOf = (chunks: ChunkEvent[]): string =>
  chunks.map((chunkEvent) => chunkEvent.text).join("\n\n");

const RESPONSE_WRAPPER = /^\s*<response>([\S\s]*?)<\/response>\s*$/;

// 出力契約 <response><action/><dialogue/><inner/></response> の各タグの中身を抜く。
// splitChunks は <response> の包みを剥がしとるので、包みは有っても無くても受ける。
// 同じタグが複数あれば空行で繋ぐ（捨てん）。該当タグが無ければ null。
const TAG_PATTERNS = {
  action: /<action>([\S\s]*?)<\/action>/g,
  dialogue: /<dialogue>([\S\s]*?)<\/dialogue>/g,
  inner: /<inner>([\S\s]*?)<\/inner>/g,
} as const;

const extractTag = (content: string, tag: keyof typeof TAG_PATTERNS): string | null => {
  const body = RESPONSE_WRAPPER.exec(content)?.[1] ?? content;
  const parts = [...body.matchAll(TAG_PATTERNS[tag])].map((match) => match[1].trim());
  return parts.length > 0 ? parts.join("\n\n") : null;
};

const sceneLedgerSchema = z.object({
  phase: z.enum(["conversation", "intimate", "erotic", "climax", "afterglow"]),
  location: z.string().nullable(),
  time: z.string().nullable(),
  present: z.array(z.string()),
  clothing: z.record(z.string(), z.string()),
  position: z.string().nullable(),
  lastEvents: z.array(z.string()),
}) satisfies z.ZodType<SceneLedger>;

// 壊れた ledger_json を黙って初期値に戻すと場面状態が消えたまま会話が続く。ここは投げる。
const parseLedger = (conversationId: string, turn: number, ledgerJson: string): SceneLedger => {
  const parsed = sceneLedgerSchema.safeParse(JSON.parse(ledgerJson));
  if (!parsed.success) {
    throw new Error(
      `v2_ledger の ledger_json が SceneLedger として読めん: conversation=${conversationId} turn=${turn}: ${parsed.error.message}`,
    );
  }
  return parsed.data;
};

// role の並びは 'assistant' < 'user' の辞書順やと逆になるので、明示的に user を先にする。
const userFirst = sql`case ${v2MessageTable.role} when 'user' then 0 else 1 end`;

/**
 * v2_* テーブルに保存する TurnStore。
 * saveTurn は 1 回の D1 batch（トランザクション）で書くので、途中失敗で半端な行は残らん。
 * 同じ (conversationId, turn) を二度保存したら置き換える（既存の message/chunk/ledger/generation を
 * 消してから入れる）。
 * persist はストリーム完了後の最終ノードで、利用者は chunk を既に見とる。再実行（checkpoint からの
 * 再開・SSE 切断後の再送）で unique index に当たって turn 全体を失敗させるより、DB を最後に
 * 表示された内容へ揃える方が履歴の一貫性を保てる。
 *
 * ローカル D1 への migration: `pnpm db:migrate:local`。
 * 本番 D1 への migration は wrangler login 済みの Mac で `pnpm db:migrate:remote`
 * （= `wrangler d1 migrations apply adult-ai-db --remote`）。
 */
export const createD1TurnStore = (db: V2Db, opts: D1TurnStoreOptions): TurnStore => ({
  load: async (conversationId) => {
    const [conversationRows, messageRows, ledgerRows] = await db.batch([
      db
        .select({ id: v2ConversationTable.id })
        .from(v2ConversationTable)
        .where(eq(v2ConversationTable.id, conversationId)),
      db
        .select({
          turn: v2MessageTable.turn,
          role: v2MessageTable.role,
          content: v2MessageTable.content,
        })
        .from(v2MessageTable)
        .where(eq(v2MessageTable.conversationId, conversationId))
        .orderBy(asc(v2MessageTable.turn), userFirst),
      db
        .select({ turn: v2LedgerTable.turn, ledgerJson: v2LedgerTable.ledgerJson })
        .from(v2LedgerTable)
        .where(eq(v2LedgerTable.conversationId, conversationId))
        .orderBy(desc(v2LedgerTable.turn))
        .limit(1),
    ]);
    if (conversationRows.length === 0) {
      return { history: [], ledger: emptyLedger(), turn: 1 };
    }
    const history: HistoryMessage[] = messageRows.map((row) => ({
      role: row.role,
      content: row.content,
    }));
    const maxTurn = messageRows.reduce((max, row) => Math.max(max, row.turn), 0);
    const latestLedger = ledgerRows[0];
    const ledger = latestLedger
      ? parseLedger(conversationId, latestLedger.turn, latestLedger.ledgerJson)
      : emptyLedger();
    return { history, ledger, turn: maxTurn + 1 };
  },

  saveTurn: async (input) => {
    const now = Date.now();
    const chunks = input.events.filter(isChunkEvent).sort((a, b) => a.seq - b.seq);
    const generations = input.events.filter(isGenerationEvent);
    const assistantText = assistantTextOf(chunks);
    const userMessageId = crypto.randomUUID();
    const assistantMessageId = crypto.randomUUID();
    const sameTurn = and(
      eq(v2MessageTable.conversationId, input.conversationId),
      eq(v2MessageTable.turn, input.turn),
    );
    // 生成が複数回あっても assistant 行が指すのは最後の 1 件（本文を作った生成）。
    const lastGeneration = generations.at(-1);

    await db.batch([
      db
        .insert(v2ConversationTable)
        .values({
          id: input.conversationId,
          userId: opts.userId,
          characterId: opts.characterId,
          threadId: input.threadId ?? input.conversationId,
          promptVersion: opts.promptVersion,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: v2ConversationTable.id,
          set: { updatedAt: now, threadId: input.threadId ?? input.conversationId },
        }),
      // 置き換え: 同じ turn の既存行を chunk → message → ledger → generation の順（FK の子から）で消す。
      db
        .delete(v2ChunkTable)
        .where(
          inArray(
            v2ChunkTable.messageId,
            db.select({ id: v2MessageTable.id }).from(v2MessageTable).where(sameTurn),
          ),
        ),
      db.delete(v2MessageTable).where(sameTurn),
      db
        .delete(v2LedgerTable)
        .where(
          and(
            eq(v2LedgerTable.conversationId, input.conversationId),
            eq(v2LedgerTable.turn, input.turn),
          ),
        ),
      db
        .delete(v2GenerationTable)
        .where(
          and(
            eq(v2GenerationTable.conversationId, input.conversationId),
            eq(v2GenerationTable.turn, input.turn),
          ),
        ),
      ...generations.map((generation) =>
        db.insert(v2GenerationTable).values({
          id: generation.generationId,
          conversationId: input.conversationId,
          turn: input.turn,
          model: generation.model,
          promptVersion: generation.promptVersion,
          systemPrompt: generation.systemPrompt,
          requestJson: JSON.stringify(generation.request),
          rawOutput: generation.rawOutput,
          usageJson: generation.usage ? JSON.stringify(generation.usage) : null,
          latencyMs: generation.latencyMs,
          status: generation.status,
          error: generation.error ?? null,
          createdAt: now,
        }),
      ),
      db.insert(v2MessageTable).values({
        id: userMessageId,
        conversationId: input.conversationId,
        turn: input.turn,
        role: "user",
        content: input.userText,
        createdAt: now,
      }),
      db.insert(v2MessageTable).values({
        id: assistantMessageId,
        conversationId: input.conversationId,
        turn: input.turn,
        role: "assistant",
        content: assistantText,
        action: extractTag(assistantText, "action"),
        dialogue: extractTag(assistantText, "dialogue"),
        inner: extractTag(assistantText, "inner"),
        generationId: lastGeneration?.generationId ?? null,
        createdAt: now,
      }),
      // D1 は 1 文あたりのバインド変数が 100 個までなので、chunk は 1 行 1 文で入れる。
      ...chunks.map((chunkEvent) =>
        db.insert(v2ChunkTable).values({
          id: crypto.randomUUID(),
          messageId: assistantMessageId,
          seq: chunkEvent.seq,
          text: chunkEvent.text,
          judgeJson: JSON.stringify(chunkEvent.judge),
          attempt: chunkEvent.attempt,
          createdAt: now,
        }),
      ),
      db.insert(v2LedgerTable).values({
        conversationId: input.conversationId,
        turn: input.turn,
        ledgerJson: JSON.stringify(input.ledger),
        createdAt: now,
      }),
    ]);
  },
});
