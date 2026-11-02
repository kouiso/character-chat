// TurnStore の契約と、その D1 実装（v2_* テーブル）。
// 契約をここ（@v2/db）に置くのは、@v2/engine が package.json で @v2/db に依存しとるため。
// engine 側で定義すると db → engine → db の循環になる。engine は型を再 export して使う。
import { emptyLedger, type SceneLedger, type ScenePhase } from "@v2/prompt";
import { asc, desc, eq, and, inArray, lt, lte, sql } from "drizzle-orm";
import { z } from "zod";

import { messageTable } from "../../../src/schema/message";

import { scheduleChunks } from "./chunk-schedule";
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
  // preExtend: extend ノードの書き足しより前（初回生成分）に切れた塊かどうか。
  // N2 解析が水増し前の本文を塊単位で復元するのに使う（graph.ts の chunk ノードで
  // 生の出力内の開始位置と preExtendRawLength を比べて決める）。
  | {
      type: "chunk";
      seq: number;
      text: string;
      judge: JudgeResult;
      attempt: number;
      preExtend: boolean;
    }
  // 判定で 2 回落ちて配らんことにした塊。本文には出さず、監視と transcript の数字にだけ使う。
  | { type: "dropped"; seq: number; reasons: string[]; attempt: number }
  | ({ type: "generation" } & GenerationRecord)
  // ターンの観測値だけを SSE へ流す。generation 本体は systemPrompt と request 丸ごとを抱えとるので
  // 配信に載せられん（engine テストが not.toContain("generation") で固定しとる）。ベンチが要るのは
  // 「字数不足で書き足しを食らったか」「打ち切られたか」だけなので、その 2 つを別の軽い事象で出す。
  | {
      type: "turn-meta";
      extended: number;
      truncated: "chars" | "deadline" | null;
      model: string;
      latencyMs: number;
      // 実際に閾値・penalty・目安字数を決めた段（--mechanics 指定時は台帳の段とズレる）。
      // 段ごとの率は全部これで集計する。台本の intent とは別物。
      mechanicsPhase: ScenePhase;
      // extend が走る前の本文（初回生成）の可視字数。extend が走らんかったターンでも
      // 常に入る（shortfall の連続量は発火の有無に関わらず要る）。
      preExtendVisibleChars: number;
      // 文脈の予算で model へ渡さんかった古い履歴の件数。長い会話で「忘れた」と「切った」を見分ける。
      omittedHistoryMessages: number;
    }
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
  beforeTurn?: number;
};

export class ConversationAccessError extends Error {
  constructor() {
    super("会話が見つかりません");
    this.name = "ConversationAccessError";
  }
}

const assertConversationOwner = async (db: V2Db, opts: D1TurnStoreOptions, id: string) => {
  const [row] = await db
    .select({ userId: v2ConversationTable.userId, characterId: v2ConversationTable.characterId })
    .from(v2ConversationTable)
    .where(eq(v2ConversationTable.id, id));
  if (row && (row.userId !== opts.userId || row.characterId !== opts.characterId)) {
    throw new ConversationAccessError();
  }
};

// 移行済み会話には挨拶や連続するassistant発言があるため、配列位置でターンを推測しない。
export const readD1StoredTurn = async (
  db: V2Db,
  opts: D1TurnStoreOptions,
  conversationId: string,
  turn: number,
): Promise<HistoryMessage[]> => {
  await assertConversationOwner(db, opts, conversationId);
  return db
    .select({ role: v2MessageTable.role, content: v2MessageTable.content })
    .from(v2MessageTable)
    .where(and(eq(v2MessageTable.conversationId, conversationId), eq(v2MessageTable.turn, turn)))
    .orderBy(asc(v2MessageTable.createdAt), asc(v2MessageTable.id));
};

export const readOwnedImageKey = async (db: V2Db, userId: string, messageId: string) => {
  const [row] = await db
    .select({ key: messageTable.imageKey })
    .from(v2MessageTable)
    .innerJoin(v2ConversationTable, eq(v2ConversationTable.id, v2MessageTable.conversationId))
    .innerJoin(messageTable, eq(messageTable.id, v2MessageTable.id))
    .where(and(eq(v2MessageTable.id, messageId), eq(v2ConversationTable.userId, userId)));
  return row?.key ?? null;
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

// engine の persist は本文ゼロで終わった生成（締切で 1 字も来ん・全塊が判定で落ちた・空の返事）も
// 監視用に保存し、同時に error を流してターンを失敗させる。つまり「応答が空」は失敗の印になっとる。
// 保存済みとして返すと、利用者の送り直しが次の turn に積まれ、model が空の応答と同じ質問の重複を
// 読む。失敗ターンは履歴から外し、末尾のそれは次の saveTurn が同じ turn を置き換える。
const isDeadTurn = (rows: { role: "user" | "assistant"; content: string }[]): boolean => {
  const assistants = rows.filter((row) => row.role === "assistant");
  return (
    rows.some((row) => row.role === "user") &&
    assistants.length > 0 &&
    assistants.every((row) => row.content.trim() === "")
  );
};

type StoredRow = { turn: number; role: "user" | "assistant"; content: string };

// 修正前の画面は失敗後に次の番号へ進んだので、失敗ターンが続けて残っとる会話がある。
// 途中の失敗ターンも履歴から外し、場面状態は最後に成功したターンのものを使う。
// 画面用の読込（readDisplayHistory）も同じ規則を通す。別の規則で数えると、画面に残った
// 失敗ターンが次の送信で黙って上書きされる。
const splitDeadTurns = <Row extends StoredRow>(rows: Row[]) => {
  const rowsByTurn = new Map<number, Row[]>();
  for (const row of rows) {
    rowsByTurn.set(row.turn, [...(rowsByTurn.get(row.turn) ?? []), row]);
  }
  const deadTurns = new Set(
    [...rowsByTurn].filter(([, turnRows]) => isDeadTurn(turnRows)).map(([turn]) => turn),
  );
  const liveTurns = [...rowsByTurn.keys()].filter((turn) => !deadTurns.has(turn));
  const maxTurn = Math.max(0, ...rowsByTurn.keys());
  return {
    live: rows.filter((row) => !deadTurns.has(row.turn)),
    lastLiveTurn: Math.max(0, ...liveTurns),
    // 末尾の失敗ターンは次の saveTurn が同じ番号で置き換える。
    nextTurn: deadTurns.has(maxTurn) ? maxTurn : maxTurn + 1,
  };
};

export type ScheduledChunk = { seq: number; text: string; scheduledAt: number };

export type DisplayHistoryRow = {
  id: string;
  turn: number;
  role: "user" | "assistant";
  content: string;
  imageKey: string | null;
  chunks?: ScheduledChunk[];
};

// 画面の履歴と次の番号を 1 回の読込から作る（GET history と ChatRoom の job.turn が同じ値を見る）。
export const readDisplayHistory = async (
  db: V2Db,
  opts: D1TurnStoreOptions,
  conversationId: string,
): Promise<{ turn: number; history: DisplayHistoryRow[] }> => {
  await assertConversationOwner(db, opts, conversationId);
  const [rows, chunks] = await db.batch([
    db
      .select({
        id: v2MessageTable.id,
        turn: v2MessageTable.turn,
        role: v2MessageTable.role,
        content: v2MessageTable.content,
        imageKey: messageTable.imageKey,
      })
      .from(v2MessageTable)
      .leftJoin(messageTable, eq(messageTable.id, v2MessageTable.id))
      .where(eq(v2MessageTable.conversationId, conversationId))
      .orderBy(asc(v2MessageTable.turn), userFirst),
    db
      .select({
        messageId: v2ChunkTable.messageId,
        seq: v2ChunkTable.seq,
        text: v2ChunkTable.text,
        scheduledAt: v2ChunkTable.scheduledAt,
      })
      .from(v2ChunkTable)
      .innerJoin(v2MessageTable, eq(v2MessageTable.id, v2ChunkTable.messageId))
      .where(eq(v2MessageTable.conversationId, conversationId))
      .orderBy(asc(v2ChunkTable.seq)),
  ]);
  const { live, nextTurn } = splitDeadTurns(rows);
  const byMessage = new Map<string, ScheduledChunk[]>();
  for (const { messageId, ...chunk } of chunks) {
    const group = byMessage.get(messageId) ?? [];
    group.push(chunk);
    byMessage.set(messageId, group);
  }
  return {
    turn: nextTurn,
    history: live.map((row) => ({
      ...row,
      ...(row.role === "assistant" && byMessage.has(row.id)
        ? { chunks: byMessage.get(row.id) }
        : {}),
    })),
  };
};

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
    await assertConversationOwner(db, opts, conversationId);
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
        .where(
          and(
            eq(v2MessageTable.conversationId, conversationId),
            opts.beforeTurn === undefined ? undefined : lt(v2MessageTable.turn, opts.beforeTurn),
          ),
        )
        .orderBy(asc(v2MessageTable.turn), userFirst),
      db
        .select({ turn: v2LedgerTable.turn, ledgerJson: v2LedgerTable.ledgerJson })
        .from(v2LedgerTable)
        .where(
          and(
            eq(v2LedgerTable.conversationId, conversationId),
            opts.beforeTurn === undefined ? undefined : lt(v2LedgerTable.turn, opts.beforeTurn),
          ),
        )
        .orderBy(desc(v2LedgerTable.turn))
        .limit(1),
    ]);
    if (conversationRows.length === 0) {
      return { history: [], ledger: emptyLedger(), turn: 1 };
    }
    const { live, lastLiveTurn, nextTurn } = splitDeadTurns(messageRows);
    const history = live.map((row): HistoryMessage => ({ role: row.role, content: row.content }));
    const [latestLedger] =
      ledgerRows[0] && ledgerRows[0].turn > lastLiveTurn
        ? await db
            .select({ turn: v2LedgerTable.turn, ledgerJson: v2LedgerTable.ledgerJson })
            .from(v2LedgerTable)
            .where(
              and(
                eq(v2LedgerTable.conversationId, conversationId),
                lte(v2LedgerTable.turn, lastLiveTurn),
              ),
            )
            .orderBy(desc(v2LedgerTable.turn))
            .limit(1)
        : ledgerRows;
    const ledger = latestLedger
      ? parseLedger(conversationId, latestLedger.turn, latestLedger.ledgerJson)
      : emptyLedger();
    // beforeTurn は呼び出し側（ChatRoom の job）が演じる番号を決めた後の読込。窓の中の末尾が
    // 失敗ターンでも番号を下げると、job と別の turn へ保存してしまう。
    return { history, ledger, turn: opts.beforeTurn ?? nextTurn };
  },

  saveTurn: async (input) => {
    await assertConversationOwner(db, opts, input.conversationId);
    const now = Date.now();
    const chunks = scheduleChunks(
      input.events.filter(isChunkEvent).sort((a, b) => a.seq - b.seq),
      now,
    );
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
          scheduledAt: chunkEvent.scheduledAt,
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
