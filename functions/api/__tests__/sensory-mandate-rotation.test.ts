import { describe, expect, it } from "vitest";

import { buildSpecificSensoryMandate } from "../lib/route-context";

import type { ChatMessage } from "../lib/route-context";

const DOWNER_SHEET = [
  "【キャラクター】ダウナー",
  "sensory_focus: 雨音、湿ったパーカー、コンクリートの冷たさ、ココアの匂い、青白い街灯",
].join("\n");

// 実測（本番と同じ 5 項目・70 ターン）で「ココアの匂い」「青白い街灯」が 0 回やった。
// 「匂い」「冷たさ」の 2 字断片が別語（雨の匂い / 金属の冷たさ）へ当たって
// 「前回使った」と誤判定され、3 項目が永久に選ばれんかったのが原因。
const assistantTurn = (action: string): ChatMessage => ({
  role: "assistant",
  content: `<action>${action}</action><dialogue>…</dialogue>`,
});

const userTurn: ChatMessage = { role: "user", content: "もっと" };
const systemTurn: ChatMessage = { role: "system", content: DOWNER_SHEET };

const pickedItem = (mandate: string): string | null => mandate.match(/「([^」]+)」/)?.[1] ?? null;

const buildHistory = (turns: number, action: string): ChatMessage[] => {
  const messages: ChatMessage[] = [systemTurn];
  for (let i = 0; i < turns; i++) {
    messages.push(userTurn, assistantTurn(action));
  }
  return messages;
};

describe("buildSpecificSensoryMandate", () => {
  it("地の文が『雨の匂い』『金属の冷たさ』を含み続けても、5 項目すべてが選ばれる", () => {
    const action = "雨の匂いが立ちのぼる。金属の冷たさが指先に残っとる。";
    const picked = new Set<string>();
    for (let turns = 0; turns < 10; turns++) {
      const mandate = buildSpecificSensoryMandate(buildHistory(turns, action), "erotic");
      const item = pickedItem(mandate);
      if (item) picked.add(item);
    }
    expect([...picked].sort()).toEqual(
      ["ココアの匂い", "コンクリートの冷たさ", "湿ったパーカー", "青白い街灯", "雨音"].sort(),
    );
  });

  // 送る履歴は 25 ターンで切られる。ターン数だけで回すと 26 ターン目から数が止まって、
  // 以後ずっと同じ項目が出る。窓が埋まった後こそ変化が要る。
  it("履歴が上限で頭打ちになっても項目が回り続ける", () => {
    const CAPPED_TURNS = 25;
    const picked = new Set<string>();
    for (let turn = 0; turn < 12; turn++) {
      const messages: ChatMessage[] = [systemTurn];
      for (let i = 0; i < CAPPED_TURNS; i++) {
        messages.push(userTurn, assistantTurn(`${turn + i} 番目の返信。雨音が響く。`));
      }
      const item = pickedItem(buildSpecificSensoryMandate(messages, "erotic"));
      if (item) picked.add(item);
    }
    expect(picked.size).toBeGreaterThan(1);
  });

  it("同じ履歴を 2 回渡したら同じ項目が返る（時計に依存せん）", () => {
    const history = buildHistory(4, "雨音が響く。");
    expect(buildSpecificSensoryMandate(history, "erotic")).toBe(
      buildSpecificSensoryMandate(history, "erotic"),
    );
  });

  it("climax と afterglow では【シナリオ】の情景を差し戻さん", () => {
    const history = buildHistory(6, "雨音が響く。");
    expect(buildSpecificSensoryMandate(history, "climax")).toBe("");
    expect(buildSpecificSensoryMandate(history, "afterglow")).toBe("");
  });

  it("初回ターンでも項目を全部並べて見せん", () => {
    const mandate = buildSpecificSensoryMandate([systemTurn, userTurn], "conversation");
    expect(mandate).not.toContain("Available senses");
    expect(mandate.match(/「[^」]+」/g)).toHaveLength(1);
  });

  it("sensory_focus が無いシートでは何も足さん", () => {
    expect(
      buildSpecificSensoryMandate([{ role: "system", content: "【キャラクター】х" }], "erotic"),
    ).toBe("");
    expect(buildSpecificSensoryMandate([userTurn], "erotic")).toBe("");
  });
});
