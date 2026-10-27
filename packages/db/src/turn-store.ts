// TurnStore の契約と、その D1 実装（v2_* テーブル）。
// 契約をここ（@v2/db）に置くのは、@v2/engine が package.json で @v2/db に依存しとるため。
// engine 側で定義すると db → engine → db の循環になる。engine は型を再 export して使う。
import { emptyLedger, type SceneLedger, type ScenePhase } from "@v2/prompt";
import { asc, desc, eq, and, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { scheduleChunks } from "./chunk-schedule";
import { modelCallsSchema } from "./model-attempt";
import {
  v2ChunkTable,
  v2ChunkRejectionTable,
  v2ConversationTable,
  v2GenerationTable,
  v2LedgerTable,
  v2MessageTable,
  v2TurnCommitTable,
  v2TurnDeliveryTable,
} from "./v2-schema";

import type { V2Db } from "./client";
import type { ModelCall } from "./model-attempt";
import type { JudgeResult } from "@v2/judge";

export type HistoryMessage = { role: "user" | "assistant"; content: string };

export type ChunkDelivery = {
  conversationId: string;
  turn: number;
  generationId: string | null;
  serverNow: number;
  chunks: { seq: number; text: string; scheduledAt: number }[];
};

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
  modelCalls?: readonly ModelCall[];
  // "aborted" は engine 側が request を止めた時（受信字数の上限か締切）。理由は truncated に載る。
  status: "ok" | "error" | "aborted";
  error?: string;
  // 1 ターンの上限で切った生成。chars = 受け取った生の字数が上限を超えた、deadline = 締切（timeoutMs）。
  truncated?: "chars" | "deadline";
};

export type TurnEvent =
  | { type: "token"; text: string }
  | ({ type: "delivery" } & ChunkDelivery)
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
  commit?: { expectedTurn: number; writeId: string };
};

export class ConversationAccessError extends Error {
  constructor() {
    super("会話が見つかりません");
    this.name = "ConversationAccessError";
  }
}

export class TurnCommitConflictError extends Error {
  constructor() {
    super("会話の保存状態が更新されています");
    this.name = "TurnCommitConflictError";
  }
}

const canonicalValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalValue(Reflect.get(value, key))]),
    );
  }
  return value;
};

const digestOf = async (value: unknown): Promise<string> => {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalValue(value)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const validateCommit = (input: SaveTurnInput): void => {
  const turn = z.number().int().positive().safeParse(input.turn);
  const commit = z
    .object({
      expectedTurn: z.number().int().positive(),
      writeId: z.string().regex(/^[\w.:-]{1,200}$/),
    })
    .optional()
    .safeParse(input.commit);
  if (!turn.success || !commit.success || (commit.data && commit.data.expectedTurn !== turn.data)) {
    throw new TurnCommitConflictError();
  }
};

const databaseErrorIncludes = (error: unknown, text: string): boolean => {
  const seen = new Set<unknown>();
  let current = error;
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if (current.message.includes(text)) return true;
    current = current.cause;
  }
  return false;
};

const rethrowCommitError = (error: unknown): never => {
  if (databaseErrorIncludes(error, "v2_turn_commit_owner")) throw new ConversationAccessError();
  if (databaseErrorIncludes(error, "v2_turn_commit_cas")) throw new TurnCommitConflictError();
  throw error;
};

const nullableJson = (value: unknown): string | null =>
  value === null || value === undefined ? null : JSON.stringify(value);

const modelCallsJsonOf = (calls: readonly ModelCall[] | undefined): string | null => {
  if (calls === undefined) return null;
  const parsed = modelCallsSchema.safeParse(calls);
  if (!parsed.success) throw new Error("モデル試行の監査情報が不正です");
  return JSON.stringify(parsed.data);
};

// load() が返す turn は「次に演じるターン番号」（graph.ts の intake がそのまま state.turn に入れ、
// persist が同じ値で saveTurn する）。空の会話は 1。createMemoryTurnStore と同じ意味。
export type TurnStore = {
  load: (conversationId: string) => Promise<TurnStoreLoaded>;
  saveTurn: (input: SaveTurnInput) => Promise<void | ChunkDelivery>;
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

const lastGenerationIdOf = (generations: GenerationEvent[]): string | null =>
  generations.at(-1)?.generationId ?? null;

const payloadDigest = async (
  input: SaveTurnInput,
  opts: D1TurnStoreOptions,
): Promise<string | null> => {
  if (!input.commit) return null;
  return digestOf({
    conversationId: input.conversationId,
    turn: input.turn,
    userText: input.userText,
    chunks: input.events.filter(isChunkEvent).sort((left, right) => left.seq - right.seq),
    dropped: input.events.filter((event) => event.type === "dropped"),
    generations: input.events.filter(isGenerationEvent),
    ledger: input.ledger,
    threadId: input.threadId ?? input.conversationId,
    promptVersion: opts.promptVersion,
  });
};

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
 * commit 付き保存は next turn を原子的に獲得し、同じ writeId と本文の再送だけを無変更で返す。
 * commit 未指定の従来 writer は同じ turn を置換できるが、確定済み commit の上書きはできん。
 *
 * ローカル D1 への migration: `pnpm db:migrate:local`。
 * 本番 D1 への migration は wrangler login 済みの Mac で `pnpm db:migrate:remote`
 * （= `wrangler d1 migrations apply adult-ai-db --remote`）。
 */
export const createD1TurnStore = (db: V2Db, opts: D1TurnStoreOptions): TurnStore => ({
  load: async (conversationId) => {
    const owner = and(
      eq(v2ConversationTable.id, conversationId),
      eq(v2ConversationTable.userId, opts.userId),
      eq(v2ConversationTable.characterId, opts.characterId),
    );
    const [conversationRows, messageRows, ledgerRows] = await db.batch([
      db
        .select({
          id: v2ConversationTable.id,
          userId: v2ConversationTable.userId,
          characterId: v2ConversationTable.characterId,
        })
        .from(v2ConversationTable)
        .where(eq(v2ConversationTable.id, conversationId)),
      db
        .select({
          turn: v2MessageTable.turn,
          role: v2MessageTable.role,
          content: v2MessageTable.content,
        })
        .from(v2MessageTable)
        .innerJoin(v2ConversationTable, eq(v2ConversationTable.id, v2MessageTable.conversationId))
        .where(owner)
        .orderBy(asc(v2MessageTable.turn), userFirst),
      db
        .select({ turn: v2LedgerTable.turn, ledgerJson: v2LedgerTable.ledgerJson })
        .from(v2LedgerTable)
        .innerJoin(v2ConversationTable, eq(v2ConversationTable.id, v2LedgerTable.conversationId))
        .where(owner)
        .orderBy(desc(v2LedgerTable.turn))
        .limit(1),
    ]);
    if (conversationRows.length === 0) {
      return { history: [], ledger: emptyLedger(), turn: 1 };
    }
    if (
      conversationRows[0].userId !== opts.userId ||
      conversationRows[0].characterId !== opts.characterId
    ) {
      throw new ConversationAccessError();
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
    validateCommit(input);
    const now = Date.now();
    const generations = input.events.filter(isGenerationEvent);
    const generationAudit = generations.map((generation) =>
      modelCallsJsonOf(generation.modelCalls),
    );
    const chunks = scheduleChunks(input.events.filter(isChunkEvent), now);
    const assistantText = assistantTextOf(chunks);
    const lastGenerationId = lastGenerationIdOf(generations);
    const writeNonce = crypto.randomUUID();
    const writeId = input.commit?.writeId ?? null;
    const digest = await payloadDigest(input, opts);
    const threadId = input.threadId ?? input.conversationId;
    const sameTurn = and(
      eq(v2MessageTable.conversationId, input.conversationId),
      eq(v2MessageTable.turn, input.turn),
    );
    const owner = and(
      eq(v2ConversationTable.id, input.conversationId),
      eq(v2ConversationTable.userId, opts.userId),
      eq(v2ConversationTable.characterId, opts.characterId),
    );
    const ownerGuard = sql<number>`case when exists (select 1 from ${v2ConversationTable}
      where ${owner}) then 1 else 0 end`;
    const priorCommit = sql`select 1 from ${v2TurnCommitTable}
      where ${v2TurnCommitTable.conversationId} = ${input.conversationId}
        and ${v2TurnCommitTable.turn} = ${input.turn}`;
    const nextTurn = sql<number>`(select coalesce(max(${v2MessageTable.turn}), 0) + 1
      from ${v2MessageTable} where ${v2MessageTable.conversationId} = ${input.conversationId})`;
    const commitGuard = input.commit
      ? sql<number>`case when
          (not exists (${priorCommit}) and ${input.turn} = ${nextTurn}) or
          exists (${priorCommit} and ${v2TurnCommitTable.writeId} = ${writeId}
            and ${v2TurnCommitTable.digest} = ${digest})
        then 1 else 0 end`
      : sql<number>`case when not exists (${priorCommit}
          and ${v2TurnCommitTable.writeId} is not null) then 1 else 0 end`;
    // nonce を初回だけ保持し、同じ commit の再送では履歴・予定・監査を更新せん。
    const writeAllowed = sql`exists (${priorCommit}
      and ${v2TurnCommitTable.writeNonce} = ${writeNonce})`;
    const selectValues = (values: readonly unknown[]) =>
      sql`select ${sql.join(
        values.map((value) => sql`${value}`),
        sql`, `,
      )} where ${writeAllowed}`;
    const userMessageId = crypto.randomUUID();
    const assistantMessageId = crypto.randomUUID();
    const anchor = sql<number>`(select ${v2TurnDeliveryTable.startAt} from ${v2TurnDeliveryTable}
      where ${v2TurnDeliveryTable.conversationId} = ${input.conversationId}
        and ${v2TurnDeliveryTable.turn} = ${input.turn})`;
    const deliveryQuery = db
      .select({
        seq: v2ChunkTable.seq,
        text: v2ChunkTable.text,
        scheduledAt: v2ChunkTable.scheduledAt,
        createdAt: v2MessageTable.createdAt,
        generationId: v2MessageTable.generationId,
      })
      .from(v2MessageTable)
      .leftJoin(v2ChunkTable, eq(v2ChunkTable.messageId, v2MessageTable.id))
      .where(and(sameTurn, eq(v2MessageTable.role, "assistant")))
      .orderBy(asc(v2ChunkTable.seq));

    const batch = [
      db
        .insert(v2ConversationTable)
        .values({
          id: input.conversationId,
          userId: opts.userId,
          characterId: opts.characterId,
          threadId,
          promptVersion: opts.promptVersion,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing(),
      // CHECK による拒否を batch 内で発生させ、先行する会話作成も含めて巻き戻す。
      db
        .insert(v2TurnCommitTable)
        .values({
          conversationId: input.conversationId,
          turn: input.turn,
          writeId,
          digest,
          writeNonce,
          ownerGuard,
          commitGuard,
        })
        .onConflictDoUpdate({
          target: [v2TurnCommitTable.conversationId, v2TurnCommitTable.turn],
          set: {
            ownerGuard: sql`excluded.owner_guard`,
            commitGuard: sql`excluded.commit_guard`,
            writeNonce: sql`case when ${v2TurnCommitTable.writeId} is null
            then excluded.write_nonce else ${v2TurnCommitTable.writeNonce} end`,
          },
        }),
      db
        .update(v2ConversationTable)
        .set({
          updatedAt: now,
          threadId,
        })
        .where(and(owner, writeAllowed)),
      db
        .insert(v2TurnDeliveryTable)
        .select(
          selectValues([
            input.conversationId,
            input.turn,
            sql<number>`coalesce((select ${v2MessageTable.createdAt} from ${v2MessageTable}
          where ${sameTurn} and ${v2MessageTable.role} = 'assistant' limit 1), ${now})`,
          ]),
        )
        .onConflictDoNothing(),
      db
        .delete(v2ChunkTable)
        .where(
          and(
            writeAllowed,
            inArray(
              v2ChunkTable.messageId,
              db.select({ id: v2MessageTable.id }).from(v2MessageTable).where(sameTurn),
            ),
          ),
        ),
      db
        .delete(v2ChunkRejectionTable)
        .where(
          and(
            writeAllowed,
            inArray(
              v2ChunkRejectionTable.messageId,
              db.select({ id: v2MessageTable.id }).from(v2MessageTable).where(sameTurn),
            ),
          ),
        ),
      db.delete(v2MessageTable).where(and(sameTurn, writeAllowed)),
      db
        .delete(v2LedgerTable)
        .where(
          and(
            writeAllowed,
            eq(v2LedgerTable.conversationId, input.conversationId),
            eq(v2LedgerTable.turn, input.turn),
          ),
        ),
      db
        .delete(v2GenerationTable)
        .where(
          and(
            writeAllowed,
            eq(v2GenerationTable.conversationId, input.conversationId),
            eq(v2GenerationTable.turn, input.turn),
          ),
        ),
      ...generations.map((generation, index) =>
        db
          .insert(v2GenerationTable)
          .select(
            selectValues([
              generation.generationId,
              input.conversationId,
              input.turn,
              generation.model,
              generation.promptVersion,
              generation.systemPrompt,
              JSON.stringify(generation.request),
              generation.rawOutput,
              nullableJson(generation.usage),
              generation.latencyMs,
              generation.status,
              generation.error ?? null,
              now,
              generationAudit[index],
            ]),
          ),
      ),
      db
        .insert(v2MessageTable)
        .select(
          selectValues([
            userMessageId,
            input.conversationId,
            input.turn,
            "user",
            input.userText,
            null,
            null,
            null,
            null,
            now,
          ]),
        ),
      db
        .insert(v2MessageTable)
        .select(
          selectValues([
            assistantMessageId,
            input.conversationId,
            input.turn,
            "assistant",
            assistantText,
            extractTag(assistantText, "action"),
            extractTag(assistantText, "dialogue"),
            extractTag(assistantText, "inner"),
            lastGenerationId,
            anchor,
          ]),
        ),
      ...chunks.map((chunkEvent) =>
        db
          .insert(v2ChunkTable)
          .select(
            selectValues([
              crypto.randomUUID(),
              assistantMessageId,
              chunkEvent.seq,
              chunkEvent.text,
              JSON.stringify(chunkEvent.judge),
              chunkEvent.attempt,
              sql<number>`${anchor} + ${chunkEvent.scheduledAt - now}`,
              now,
            ]),
          ),
      ),
      ...input.events
        .filter((event) => event.type === "dropped")
        .map((event) =>
          db
            .insert(v2ChunkRejectionTable)
            .select(
              selectValues([
                assistantMessageId,
                event.seq,
                event.attempt,
                JSON.stringify(event.reasons),
                now,
              ]),
            ),
        ),
      db
        .insert(v2LedgerTable)
        .select(
          selectValues([input.conversationId, input.turn, JSON.stringify(input.ledger), now]),
        ),
      deliveryQuery,
    ] as const;
    let results;
    try {
      results = await db.batch(batch);
    } catch (error) {
      return rethrowCommitError(error);
    }
    const persisted = results.at(-1);
    if (!Array.isArray(persisted)) throw new Error("chunk 配送データを保存結果から読めん");
    return {
      conversationId: input.conversationId,
      turn: input.turn,
      generationId: persisted[0]?.generationId ?? null,
      serverNow: Date.now(),
      chunks: persisted.flatMap(({ seq, text, scheduledAt, createdAt }) =>
        seq === null || text === null ? [] : [{ seq, text, scheduledAt: scheduledAt ?? createdAt }],
      ),
    };
  },
});
