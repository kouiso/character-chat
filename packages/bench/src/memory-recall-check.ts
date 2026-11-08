// RIT-99 試験台: 植えた事実を 50・200 ターン後に聞き、正答の割合を記録する。
// 検査モデルが「事実がプロンプト内に見える時だけ正答」を返すので、
// 測っているのは retrieval が遠いターンでも記憶を指示文へ届けるか、という配管の実効。
// 3 アームを同時に出す: retrievalあり(実測)・cheat(答えを指示文へ直接記入→100%必須)・
// none(記憶なし→0%付近)。cheat 100%・none 0% で試験自体が効いとることを確かめる。
import { FakeListChatModel } from "@langchain/core/utils/testing";
import {
  createMemoryTurnStore,
  createTurnGraph,
  runTurn,
  type CharacterSheet,
  type MemoryContextEntry,
  type TurnEvent,
} from "@v2/engine";

import type { BaseMessage } from "@langchain/core/messages";
import type { ChatGenerationChunk, ChatResult } from "@langchain/core/outputs";

const CHARACTER: CharacterSheet = {
  id: "recall-bench-char",
  name: "ベンチ子",
  systemPrompt: "一人称: わたし\n二人称: あなた\n語尾: 「〜だよ」「〜なの」",
  greeting: "はじめまして、よろしくね",
};

const FACT = "私の好きな飲み物は紅茶";
const PLANT_TEXT = `${FACT}だよ`;
const QUESTION = "私の好きな飲み物は何だっけ";
const ANSWER = "紅茶";
const CHECK_TURNS = [50, 200] as const;

const FAKE_RESPONSE =
  "<response><action>ゆっくりと近づいて手を伸ばす</action><dialogue>わたし、ずっと待ってた</dialogue><inner>やっと会えて嬉しい</inner></response>";
const answerResponse = (line: string): string =>
  `<response><action>思い出して笑う</action><dialogue>${line}</dialogue><inner>記憶を確かめた</inner></response>`;
const CORRECT = answerResponse(`${ANSWER}だよ、覚えとるよ`);
const WRONG = answerResponse("ごめん、忘れちゃった");

// 質問文と同じ「私の好きな飲み物は〜だよ」型の記憶を定期的に混ぜる。
// 類似語の競合で古い記憶が埋もれるかどうかを 50/200 で見るための現実的な妨害。
const DISTRACTOR_DRINKS = ["麦茶", "烏龍茶", "玄米茶", "緑茶", "ほうじ茶", "そば茶", "昆布茶"];
const fillerText = (turn: number): string =>
  turn % 13 === 0
    ? `私の好きな飲み物は${DISTRACTOR_DRINKS[turn % DISTRACTOR_DRINKS.length]}だよ`
    : [
        "今日は少し疲れたな",
        "窓の外、雨が降ってきたよ",
        "さっきの話、もう少し聞かせて",
        "今週末は家でゆっくりするよ",
        "あの店のケーキ、美味しかったね",
      ][turn % 5];

// 最後の人間メッセージが確認質問なら、送られてきたプロンプト全体に事実が
// 見える時だけ正答を返す。見えん時は「忘れた」と返す。
class RecallJudgeModel extends FakeListChatModel {
  constructor() {
    super({ responses: [FAKE_RESPONSE] });
  }

  private decide(messages: BaseMessage[]): string {
    const asked = String(messages.at(-1)?.content ?? "");
    if (!asked.includes(QUESTION)) return FAKE_RESPONSE;
    const seen = messages.map((message) => String(message.content)).join("\n");
    return seen.includes(FACT) ? CORRECT : WRONG;
  }

  override async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const text = this.decide(messages);
    return { generations: [this._formatGeneration(text)], llmOutput: {} };
  }

  override async *_streamResponseChunks(
    messages: BaseMessage[],
  ): AsyncGenerator<ChatGenerationChunk> {
    yield this._createResponseChunk(this.decide(messages));
  }
}

// 抽出の代役: ユーザーの発言をそのまま記憶として蓄積する（実抽出は発言からの引用なので
// 形は同じ）。検索は質問と内容のバイグラム一致数・同点は新しい記憶を優先する近似。
const createBenchMemory = () => {
  const memories: MemoryContextEntry[] = [];
  const bigrams = (text: string): Set<string> => {
    const set = new Set<string>();
    for (let i = 0; i + 1 < text.length; i++) set.add(text.slice(i, i + 2));
    return set;
  };
  const retrieve = async (_conversationId: string, query: string) => {
    const want = bigrams(query);
    return [...memories]
      .map((entry, index) => {
        let score = 0;
        for (const gram of bigrams(entry.content)) if (want.has(gram)) score += 1;
        return { entry, score, index };
      })
      .sort((a, b) => b.score - a.score || b.index - a.index)
      .slice(0, 20)
      .map(({ entry }) => entry);
  };
  return {
    retrieve,
    record: (turn: number, userText: string) =>
      memories.push({ id: `bench-m${turn}`, content: userText.slice(0, 500) }),
  };
};

type Arm = "retrieval" | "cheat" | "none";

const runArm = async (arm: Arm): Promise<{ checks: Record<number, boolean>; ratio: number }> => {
  const memory = createBenchMemory();
  const graph = createTurnGraph({
    model: new RecallJudgeModel(),
    store: createMemoryTurnStore(),
    ...(arm === "retrieval" ? { retrieveMemories: memory.retrieve } : {}),
  });
  const character: CharacterSheet =
    arm === "cheat"
      ? { ...CHARACTER, systemPrompt: `${CHARACTER.systemPrompt}\n${FACT}` }
      : CHARACTER;
  const checks: Partial<Record<number, boolean>> = {};
  for (let turn = 1; turn <= 200; turn++) {
    const isCheck = (CHECK_TURNS as readonly number[]).includes(turn);
    const userText = turn === 1 ? PLANT_TEXT : isCheck ? QUESTION : fillerText(turn);
    let said = "";
    for await (const event of runTurn(
      graph,
      { conversationId: "recall-bench", userText, character },
      `recall-${arm}-${turn}`,
    ) as AsyncIterable<TurnEvent>) {
      if (event.type === "chunk") said += event.text;
    }
    if (isCheck) checks[turn] = said.includes(ANSWER);
    memory.record(turn, userText);
  }
  const results = Object.values(checks);
  return {
    checks: checks as Record<number, boolean>,
    ratio: results.filter(Boolean).length / results.length,
  };
};

export const runMemoryRecallCheck = async (): Promise<
  Record<Arm, { checks: Record<number, boolean>; ratio: number }>
> => ({
  retrieval: await runArm("retrieval"),
  cheat: await runArm("cheat"),
  none: await runArm("none"),
});

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(await runMemoryRecallCheck(), null, 2));
}
