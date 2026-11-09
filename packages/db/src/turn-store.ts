// TurnStore の契約と、その D1 実装（v2_* テーブル）。
// 契約をここ（@v2/db）に置くのは、@v2/engine が package.json で @v2/db に依存しとるため。
// engine 側で定義すると db → engine → db の循環になる。engine は型を再 export して使う。
import { emptyLedger, type SceneLedger, type ScenePhase } from "@v2/prompt";
import { asc, desc, eq, and, inArray, lt, lte, sql } from "drizzle-orm";
import { z } from "zod";

import { messageTable } from "../../../src/schema/message";

import { chunkSendTimes } from "./chunk-schedule";
import {
  v2ChunkTable,
  v2ConversationTable,
  v2GenerationTable,
  v2LedgerTable,
  v2MemoryJobTable,
  v2MemorySourceTable,
  v2MemoryTable,
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
  // 実際に返事を返した実行先（OpenRouter の provider 名）。未記録は NULL、引けんかった時は "unknown"。
  provider?: string | null;
  // OpenRouter 側の生成 id（gen-…）。実行先の照合・課金の確認に使う。
  upstreamId?: string | null;
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
  // text/judge は保存用の events だけが持つ。配信には載せん（SSE スキーマが削る）。
  | {
      type: "dropped";
      seq: number;
      reasons: string[];
      attempt: number;
      text?: string;
      judge?: JudgeResult;
    }
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
  | {
      type: "done";
      conversationId: string;
      turn: number;
      generationId: string | null;
      // 各塊の表示予定時刻（v2_chunk.send_at と同じ値）。塊が無い失敗ターンは空配列。
      // 古い保存済みイベント再生では欠けるため optional。
      sendAt?: number[];
    }
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
  saveTurn: (input: SaveTurnInput) => Promise<{ chunkSendAt: number[] }>;
};

export type D1TurnStoreOptions = {
  userId: string;
  characterId: string;
  // 会話の初回 insert で固定するキャラ版。以後のターンで参照は変えん
  //（onConflictDoUpdate の set に含めておらん）。旧会話・版未導入の流れでは省略。
  characterVersionId?: string;
  promptVersion: string;
  beforeTurn?: number;
  extractMemory?: boolean;
};

export class ConversationAccessError extends Error {
  constructor() {
    super("会話が見つかりません");
    this.name = "ConversationAccessError";
  }
}

export const ensureConversationVersion = async (
  db: V2Db,
  input: {
    conversationId: string;
    userId: string;
    characterId: string;
    promptVersion: string;
    versionId: string;
  },
): Promise<string> => {
  const now = Date.now();
  await db
    .insert(v2ConversationTable)
    .values({
      id: input.conversationId,
      userId: input.userId,
      characterId: input.characterId,
      title: "",
      threadId: input.conversationId,
      promptVersion: input.promptVersion,
      characterVersionId: input.versionId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
  let [row] = await db
    .select({
      userId: v2ConversationTable.userId,
      characterId: v2ConversationTable.characterId,
      characterVersionId: v2ConversationTable.characterVersionId,
    })
    .from(v2ConversationTable)
    .where(eq(v2ConversationTable.id, input.conversationId));
  if (!row || row.userId !== input.userId || row.characterId !== input.characterId) {
    throw new ConversationAccessError();
  }
  if (row.characterVersionId) return row.characterVersionId;
  await db
    .update(v2ConversationTable)
    .set({ characterVersionId: input.versionId })
    .where(
      and(
        eq(v2ConversationTable.id, input.conversationId),
        eq(v2ConversationTable.userId, input.userId),
        eq(v2ConversationTable.characterId, input.characterId),
        sql`${v2ConversationTable.characterVersionId} is null`,
      ),
    );
  [row] = await db
    .select({
      userId: v2ConversationTable.userId,
      characterId: v2ConversationTable.characterId,
      characterVersionId: v2ConversationTable.characterVersionId,
    })
    .from(v2ConversationTable)
    .where(eq(v2ConversationTable.id, input.conversationId));
  if (
    !row ||
    row.userId !== input.userId ||
    row.characterId !== input.characterId ||
    !row.characterVersionId
  ) {
    throw new ConversationAccessError();
  }
  return row.characterVersionId;
};

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
  // v2 生成は v2_message.image_key、旧移行メッセージは legacy message 表側に画像キーが残る。
  const [row] = await db
    .select({ key: v2MessageTable.imageKey, legacyKey: messageTable.imageKey })
    .from(v2MessageTable)
    .innerJoin(v2ConversationTable, eq(v2ConversationTable.id, v2MessageTable.conversationId))
    .leftJoin(messageTable, eq(messageTable.id, v2MessageTable.id))
    .where(and(eq(v2MessageTable.id, messageId), eq(v2ConversationTable.userId, userId)));
  return row ? (row.key ?? row.legacyKey) : null;
};

// 即時 lookup で引けんかった実行先を後から書き戻す（RIT-100: /generation の索引は ~10s 遅れる）。
// upstream_id は INSERT 時に入っとるので provider 欄だけを更新する。
export const updateGenerationProvider = async (
  db: V2Db,
  generationId: string,
  provider: string,
): Promise<void> => {
  await db
    .update(v2GenerationTable)
    .set({ provider })
    .where(eq(v2GenerationTable.id, generationId));
};

type ChunkEvent = Extract<TurnEvent, { type: "chunk" }>;
type GenerationEvent = Extract<TurnEvent, { type: "generation" }>;

// 型注釈の optional を保存時の NULL に揃えるだけ（undefined も null も空として入れる）。
const toNull = (v: string | null | undefined): string | null => v ?? null;

const isChunkEvent = (event: TurnEvent): event is ChunkEvent => event.type === "chunk";
const isDroppedEvent = (event: TurnEvent): event is Extract<TurnEvent, { type: "dropped" }> =>
  event.type === "dropped";
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

export type DisplayHistoryRow = {
  id: string;
  turn: number;
  role: "user" | "assistant";
  content: string;
  imageKey: string | null;
};

// 画面の履歴と次の番号を 1 回の読込から作る（GET history と ChatRoom の job.turn が同じ値を見る）。
export const readDisplayHistory = async (
  db: V2Db,
  opts: D1TurnStoreOptions,
  conversationId: string,
): Promise<{ turn: number; history: DisplayHistoryRow[] }> => {
  await assertConversationOwner(db, opts, conversationId);
  const rawRows = await db
    .select({
      id: v2MessageTable.id,
      turn: v2MessageTable.turn,
      role: v2MessageTable.role,
      content: v2MessageTable.content,
      imageKey: v2MessageTable.imageKey,
      legacyImageKey: messageTable.imageKey,
    })
    .from(v2MessageTable)
    .leftJoin(messageTable, eq(messageTable.id, v2MessageTable.id))
    .where(eq(v2MessageTable.conversationId, conversationId))
    .orderBy(asc(v2MessageTable.turn), userFirst);
  const rows: DisplayHistoryRow[] = rawRows.map((row) => ({
    id: row.id,
    turn: row.turn,
    role: row.role,
    content: row.content,
    imageKey: row.imageKey ?? row.legacyImageKey,
  }));
  const { live, nextTurn } = splitDeadTurns(rows);
  return { turn: nextTurn, history: live };
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
    const chunks = input.events.filter(isChunkEvent).sort((a, b) => a.seq - b.seq);
    const sendTimes = chunkSendTimes(
      chunks.map((chunk) => chunk.text),
      now,
    );
    const dropped = input.events.filter(isDroppedEvent);
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
          characterVersionId: toNull(opts.characterVersionId),
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: v2ConversationTable.id,
          set: { updatedAt: now, threadId: input.threadId ?? input.conversationId },
        }),
      db.delete(v2MemoryTable).where(
        inArray(
          v2MemoryTable.id,
          db
            .select({ id: v2MemorySourceTable.memoryId })
            .from(v2MemorySourceTable)
            .where(
              inArray(
                v2MemorySourceTable.sourceMessageId,
                db.select({ id: v2MessageTable.id }).from(v2MessageTable).where(sameTurn),
              ),
            ),
        ),
      ),
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
          provider: toNull(generation.provider),
          upstreamId: toNull(generation.upstreamId),
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
        generationId: toNull(lastGeneration?.generationId),
        provider: toNull(lastGeneration?.provider),
        upstreamId: toNull(lastGeneration?.upstreamId),
        createdAt: now,
      }),
      // D1 は 1 文あたりのバインド変数が 100 個までなので、chunk は 1 行 1 文で入れる。
      // 予定時刻は塊列から一括計算して行ごとに割り当てる（RIT-67）。
      ...chunks.map((chunkEvent, index) =>
        db.insert(v2ChunkTable).values({
          id: crypto.randomUUID(),
          messageId: assistantMessageId,
          seq: chunkEvent.seq,
          text: chunkEvent.text,
          judgeJson: JSON.stringify(chunkEvent.judge),
          attempt: chunkEvent.attempt,
          sendAt: sendTimes[index],
          createdAt: now,
        }),
      ),
      // 判定で落ちて配らんかった塊も、理由つきで残す（RIT-70）。sendAt は無し。
      ...dropped.map((droppedEvent) =>
        db.insert(v2ChunkTable).values({
          id: crypto.randomUUID(),
          messageId: assistantMessageId,
          seq: droppedEvent.seq,
          text: droppedEvent.text ?? "",
          judgeJson: JSON.stringify(
            droppedEvent.judge ?? { ok: false, reasons: droppedEvent.reasons },
          ),
          attempt: droppedEvent.attempt,
          dropped: 1,
          createdAt: now,
        }),
      ),
      db.insert(v2LedgerTable).values({
        conversationId: input.conversationId,
        turn: input.turn,
        ledgerJson: JSON.stringify(input.ledger),
        createdAt: now,
      }),
      ...(opts.extractMemory &&
      assistantText.trim() &&
      (!lastGeneration || lastGeneration.status !== "error")
        ? [
            db.insert(v2MemoryJobTable).values({
              id: userMessageId,
              sourceMessageId: userMessageId,
              conversationId: input.conversationId,
              userId: opts.userId,
              characterId: opts.characterId,
              sourceTurn: input.turn,
              createdAt: now,
              updatedAt: now,
            }),
          ]
        : []),
    ]);
    return { chunkSendAt: sendTimes };
  },
});
