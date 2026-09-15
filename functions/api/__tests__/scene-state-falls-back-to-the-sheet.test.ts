import { describe, expect, it } from "vitest";

import { buildSceneStateContinuity, resolveSceneLocation } from "../lib/route-context";

import type { ChatMessage } from "../lib/route-context";

// 実測 2026-08-18 phase32 の さくら（20歳の文学部女子大生・春のカフェ・ニット）。
// 台本の10ターンに場所を名指す語が一度も無く、t7〜t10 が教室・制服・黒板で書かれた。
const SHEET = [
  "【キャラクター】",
  "20歳の文学部女子大生、桜庭さくら。清楚で内気。",
  "【関係性】",
  "春の放課後、大学の正門であなたに声をかけられた。今日が初対面。",
  "【シナリオ】",
  "桜並木の道でさくらに声をかけた。これからカフェに行くという誘いを受けたばかり。",
  "【追加設定】",
  "服は白かクリーム色のニット。",
].join("\n");

const session = (userTurns: string[]): ChatMessage[] => [
  { role: "system", content: SHEET },
  ...userTurns.map((content) => ({ role: "user" as const, content })),
];

const NO_LOCATION_TURNS = [
  "さっきは急に声かけてごめん。",
  "普段って、どんな本読むの",
  "ここまで来て、まだ我慢しろって言う？",
];

describe("場所と服装の錨", () => {
  it("相手が場所を一度も言わんかったら、シートの場面を拠り所にする", () => {
    expect(resolveSceneLocation(session(NO_LOCATION_TURNS))).toBe("カフェ");
  });

  it("相手が場所を言うたら、そっちが勝つ", () => {
    expect(resolveSceneLocation(session([...NO_LOCATION_TURNS, "ホテルまで歩こか"]))).toBe(
      "ホテル",
    );
  });

  it("連続性の指示に場所と服装が載る", () => {
    const line = buildSceneStateContinuity(session(NO_LOCATION_TURNS), "erotic");
    expect(line).toContain("location=カフェ");
    expect(line).toContain("clothing=ニット");
  });

  it("シートに場所が無ければ黙る（嘘の場所を作らん）", () => {
    const bare: ChatMessage[] = [
      { role: "system", content: "【キャラクター】名前だけのシート。" },
      { role: "user", content: "もっと" },
    ];
    expect(resolveSceneLocation(bare)).toBeNull();
  });
});
