// pnpm v2:bench から叩く最小 CLI。fake model で 1 ターン回し、judge の集計を stdout に出す。
// 実モデル（OpenRouter）での計測は M1 以降（キーの注入とコストの提示が要る）。
import { FakeListChatModel } from "@langchain/core/utils/testing";
import {
  createMemoryTurnStore,
  createTurnGraph,
  runTurn,
  type CharacterSheet,
  type TurnEvent,
} from "@v2/engine";

export type BenchSummary = {
  tokens: number;
  chunks: number;
  ok: number;
  ng: number;
  regenerated: number;
  reasons: Record<string, number>;
};

const FAKE_CHARACTER: CharacterSheet = {
  id: "bench-char",
  name: "ベンチ子",
  systemPrompt: "一人称: わたし\n二人称: あなた\n語尾: 「〜だよ」「〜なの」",
  greeting: "はじめまして、よろしくね",
};

const FAKE_RESPONSE =
  "<response><action>ゆっくりと近づいて手を伸ばす</action><dialogue>わたし、ずっと待ってた</dialogue><inner>やっと会えて嬉しい</inner></response>";

const emptySummary = (): BenchSummary => ({
  tokens: 0,
  chunks: 0,
  ok: 0,
  ng: 0,
  regenerated: 0,
  reasons: {},
});

const fold = (summary: BenchSummary, event: TurnEvent): void => {
  if (event.type === "token") summary.tokens += 1;
  if (event.type !== "chunk") return;
  summary.chunks += 1;
  if (event.judge.ok) summary.ok += 1;
  else summary.ng += 1;
  if (event.attempt > 1) summary.regenerated += 1;
  for (const reason of event.judge.reasons) {
    summary.reasons[reason] = (summary.reasons[reason] ?? 0) + 1;
  }
};

export const runBench = async (args: string[]): Promise<BenchSummary> => {
  if (!args.includes("--fake")) {
    throw new Error("M0 の bench は --fake だけ対応（実モデル計測は M1 で足す）");
  }
  const graph = createTurnGraph({
    model: new FakeListChatModel({ responses: [FAKE_RESPONSE] }),
    store: createMemoryTurnStore(),
  });
  const summary = emptySummary();
  for await (const event of runTurn(
    graph,
    { conversationId: "bench", userText: "こんにちは", character: FAKE_CHARACTER },
    "bench",
  )) {
    fold(summary, event);
  }
  return summary;
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const summary = await runBench(process.argv.slice(2));
  console.log(JSON.stringify(summary));
}
