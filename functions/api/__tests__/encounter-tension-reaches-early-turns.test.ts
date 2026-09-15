import { describe, expect, it } from "vitest";

import { augmentMessages } from "../lib/route-context";

import type { ScenePhase } from "../../../src/lib/scene-phase";

// 実測 2026-08-17 phase12/13 さくら t1。桜並木で声をかけられた最初のターンで
// 「これからも…会ってくれますか？」「わたし、あなたとなら、全部、あげたいんです」。
// 計画の共通の失敗形1「最初から好意的」。
//
// 原因は【出会いの空気】が erotic/climax にだけ出とったこと。ブロックの中身は
// 「出会った直後の空気」で、いちばん要るのは会話の側やのに、そのターンには
// 一度も届いとらんかった。migration 0065 で「彼女」を消して初対面と判定されるように
// なっても、判定結果を使う経路が会話ターンに無い以上、何も変わらんかった。

const SYSTEM = `【キャラクター】
名前: 桜庭さくら
【シナリオ】
桜並木で声をかけられた。今日が初対面。
【関係性】
今日会ったばかり。`;

const makeD1Mock = () =>
  ({
    prepare: () => ({
      bind: () => ({
        run: async () => ({ success: true, meta: { changes: 0 }, results: [] }),
        all: async () => ({ success: true, results: [], meta: {} }),
        first: async () => null,
        raw: async () => [],
      }),
    }),
    batch: async (statements: unknown[]) =>
      statements.map(() => ({ success: true, meta: { changes: 1 }, results: [] })),
    dump: async () => new ArrayBuffer(0),
    exec: async () => ({ count: 0, duration: 0 }),
  }) as never;

const augmentedFor = async (phase: ScenePhase): Promise<string> => {
  const { messages } = await augmentMessages(
    makeD1Mock(),
    [
      { role: "system", content: SYSTEM },
      { role: "user", content: "さっきは急に声かけてごめん。" },
    ],
    phase,
  );
  return messages.map((m) => m.content).join("\n");
};

describe("【出会いの空気】が早いターンへ届く", () => {
  it.each(["conversation", "intimate", "erotic", "climax"] as const)("%s に出る", async (phase) => {
    expect(await augmentedFor(phase)).toContain("【出会いの空気】");
  });

  it("初対面のキャラには履歴を作らせん一文が入る", async () => {
    expect(await augmentedFor("conversation")).toContain("積み上がっとらんものを先取りせん");
  });

  // #1460: phase13で一度収まった「これからも、お話しできますか？」がphase14/phase15の
  // ターン1でまた出た。抽象的な注意のままではモデルがどこまで守るかは運任せなので、
  // 実際の往復数を具体的な事実として渡す。augmentMessages に渡した user メッセージが
  // 1件なら、【出会いの空気】に「まだ1往復だけ」が実際に届くことを固定する。
  it("実際に交わした往復数が具体的な事実として届く", async () => {
    expect(await augmentedFor("conversation")).toContain("まだ1往復だけ");
  });
});
