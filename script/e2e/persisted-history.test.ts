import { describe, expect, it } from "vitest";

import { selectRecentTurnsForClassifier } from "./persisted-history";

const conversation = [
  { role: "system", content: "prompt" },
  { role: "assistant", content: "はじめまして" },
  { role: "user", content: "こんばんは" },
  { role: "assistant", content: "こんばんは、待ってた" },
];

describe("selectRecentTurnsForClassifier", () => {
  it("行数が期待に届いていなければ画面側の1往復へ落とす", () => {
    expect(
      selectRecentTurnsForClassifier({
        persistedMessages: conversation,
        expectedPersistedCount: 6,
        renderedUserMsg: "触れてもいい？",
        renderedAssistantMsg: "うん、来て",
      }),
    ).toEqual([
      { role: "user", content: "触れてもいい？" },
      { role: "assistant", content: "うん、来て" },
    ]);
  });

  it("行数も内容も揃っていれば D1 の履歴をそのまま渡す", () => {
    expect(
      selectRecentTurnsForClassifier({
        persistedMessages: conversation,
        expectedPersistedCount: 4,
        renderedUserMsg: "こんばんは",
        renderedAssistantMsg: "こんばんは、待ってた",
      }),
    ).toEqual([
      { role: "assistant", content: "はじめまして" },
      { role: "user", content: "こんばんは" },
      { role: "assistant", content: "こんばんは、待ってた" },
    ]);
  });

  // 再生成経路: 行数は揃うが assistant 行の中身が空のまま残る。
  it("行数が揃っていても assistant 行が空なら画面の本文で差し替える", () => {
    const stale = [
      { role: "system", content: "prompt" },
      { role: "assistant", content: "はじめまして" },
      { role: "user", content: "触れてもいい？" },
      { role: "assistant", content: "" },
    ];

    const selected = selectRecentTurnsForClassifier({
      persistedMessages: stale,
      expectedPersistedCount: 4,
      renderedUserMsg: "触れてもいい？",
      renderedAssistantMsg: "うん、来て",
    });

    expect(selected).toEqual([
      { role: "assistant", content: "はじめまして" },
      { role: "user", content: "触れてもいい？" },
      { role: "assistant", content: "うん、来て" },
    ]);
  });

  it("プレースホルダーが残っている場合も画面の本文で差し替える", () => {
    const stale = [
      { role: "user", content: "触れてもいい？" },
      { role: "assistant", content: "ことばを探している…" },
    ];

    const selected = selectRecentTurnsForClassifier({
      persistedMessages: stale,
      expectedPersistedCount: 2,
      renderedUserMsg: "触れてもいい？",
      renderedAssistantMsg: "うん、来て",
    });

    expect(selected.at(-1)).toEqual({ role: "assistant", content: "うん、来て" });
  });

  it("画面側も空なら差し替えず D1 の履歴を尊重する", () => {
    const stale = [
      { role: "user", content: "触れてもいい？" },
      { role: "assistant", content: "" },
    ];

    const selected = selectRecentTurnsForClassifier({
      persistedMessages: stale,
      expectedPersistedCount: 2,
      renderedUserMsg: "触れてもいい？",
      renderedAssistantMsg: "   ",
    });

    expect(selected.at(-1)).toEqual({ role: "assistant", content: "" });
  });
});
