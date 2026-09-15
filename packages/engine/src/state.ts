// 1ターン分の LangGraph 状態定義。
// StateSchema（zod ベース）を使う。Jest(@swc/jest, CJS変換)で通ることは
// __tests__/graph.test.ts の実行で確認済み（doc/v2/scaffold-spec.md §14-2 の懸念への回答）。
import { StateSchema } from "@langchain/langgraph";
import { z } from "zod";

import type { CharacterSheet, ComposedPrompt, GenerationRecord, HistoryMessage } from "./types";
import type { JudgeResult } from "@v2/judge";
import type { SceneLedger, ScenePhase } from "@v2/prompt";

export type JudgedChunk = {
  seq: number;
  text: string;
  judge: JudgeResult;
  attempt: number;
  // extend の書き足しより前に切れた塊か。chunk ノードが raw 内の開始位置で決める。
  preExtend: boolean;
};

export const TurnState = new StateSchema({
  conversationId: z.string(),
  turn: z.number().default(1),
  userText: z.string(),
  // 呼ぶ側が段を指定した時だけ台帳の phase を上書きする。段の自動判定は未実装（M2 以降）なので、
  // 台本計測（bench/script-run）が台本の段を渡す口として使う。null なら台帳の値のまま。
  phase: z.custom<ScenePhase>().nullable().default(null),
  // 1 ターンの締切（ms）。null なら graph.ts の DEFAULT_TURN_TIMEOUT_MS。
  timeoutMs: z.number().nullable().default(null),
  character: z.custom<CharacterSheet>(),
  history: z.array(z.custom<HistoryMessage>()).default(() => []),
  ledger: z.custom<SceneLedger>(),
  retrieved: z.array(z.string()).default(() => []),
  prompt: z.custom<ComposedPrompt>().nullable().default(null),
  raw: z.string().default(""),
  // このターンで続きを書き足した回数（上限は graph.ts の MAX_EXTENSIONS_PER_TURN）。
  extended: z.number().default(0),
  pendingChunks: z.array(z.string()).default(() => []),
  // pendingChunks と同じ並びで、各塊が extend 前の本文に属するか。judge_chunk が
  // JudgedChunk.preExtend へ写す。再生成で本文が変わっても「位置が extend 前」という
  // 印自体は変わらんので、書き直し後もこの値を使い回す。
  pendingPreExtend: z.array(z.boolean()).default(() => []),
  // extend が走る前の本文の可視字数と生文字数。generate ノードが毎ターン必ず入れる
  // （extend が走らんターンでも shortfall の連続量が要る）。persist が turn-meta に載せ、
  // chunk が raw 内の塊の開始位置と preExtendRawLength を比べて pendingPreExtend を決める。
  // チャンネル宣言しないと generate で書いても persist へ届かん（2b4c1c90 の失敗と同じ型）。
  preExtendVisibleChars: z.number().default(0),
  preExtendRawLength: z.number().default(0),
  cursor: z.number().default(0),
  chunks: z.array(z.custom<JudgedChunk>()).default(() => []),
  // 2 回落ちて配らんことにした塊。本文にも保存にも入れず、dropped イベントと集計にだけ使う。
  dropped: z.array(z.custom<JudgedChunk>()).default(() => []),
  // 再生成は chunk ごとに1回まで（attempts で管理）。ターングローバルな真偽値やと、
  // ターン内で最初に落ちた chunk 以外は再生成されんまま通ってまう
  // （後続の失敗chunkが再生成されん = M0レビュー指摘）。
  // regenerationCount はそれとは別に、ターン全体での再生成回数に上限を掛ける安全弁
  // （病的な入力で chunk 数が多い時に無限に再生成し続けん）。
  regenerationCount: z.number().default(0),
  // 各 chunk（cursor）の試行回数。1 が初回、2 で再生成済み（上限）。
  attempts: z.array(z.number()).default(() => []),
  generationId: z.string().nullable().default(null),
  // generate ノードが 1 回の生成ごとに埋める（v2_generation 1 行分）。persist が events に載せる。
  generation: z.custom<GenerationRecord>().nullable().default(null),
});

export type TurnStateValue = typeof TurnState.State;
export type TurnStateUpdate = typeof TurnState.Update;
