import { describe, expect, it } from "vitest";

import {
  API_MESSAGE_CONTENT_MAX_LENGTH,
  buildMessagesForApi,
  buildPersonaReminder,
  buildRetryMessages,
  extractFirstPerson,
  findBannedRepeatedPhrases,
  isRefusalArtifactAssistantContent,
  normalizeAssistantMessageContent,
} from "./chat-message-adapter";

describe("extractFirstPerson", () => {
  it("一人称パターンを抽出する", () => {
    expect(extractFirstPerson("一人称は「あたし」を使う")).toBe("あたし");
  });

  it("パターンなしはnull", () => {
    expect(extractFirstPerson("普通のプロンプト")).toBeNull();
  });
});

describe("buildPersonaReminder", () => {
  it("一人称ありのリマインダー", () => {
    const reminder = buildPersonaReminder("みつき", "あたし");
    expect(reminder).toContain("みつき");
    expect(reminder).toContain("あたし");
    expect(reminder).toContain("【人格維持リマインダー】");
  });

  it("一人称なしのリマインダー", () => {
    const reminder = buildPersonaReminder("テスト", null);
    expect(reminder).toContain("テスト");
    expect(reminder).not.toContain("first-person pronoun");
  });
});

describe("buildMessagesForApi", () => {
  it("systemPromptを先頭に配置する", () => {
    const msgs = [{ role: "user" as const, content: "こんにちは", isStreaming: false }];
    const result = buildMessagesForApi(msgs, "テストプロンプト", "AI");
    expect(result[0]).toEqual({ role: "system", content: "テストプロンプト" });
  });

  it("ストリーミング中メッセージを除外する", () => {
    const msgs = [
      { role: "user" as const, content: "こんにちは", isStreaming: false },
      { role: "assistant" as const, content: "途中...", isStreaming: true },
    ];
    const result = buildMessagesForApi(msgs, "prompt", "AI");
    const nonSystemMsgs = result.filter((m) => m.role !== "system");
    expect(nonSystemMsgs).toHaveLength(1);
    expect(nonSystemMsgs[0].content).toBe("こんにちは");
  });

  it("3ターンごとにリマインダーを挿入する", () => {
    const msgs = Array.from({ length: 8 }, (_, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `msg-${i}`,
      isStreaming: false,
    }));
    const result = buildMessagesForApi(msgs, "prompt", "AI");
    const systemMsgs = result.filter((m) => m.role === "system");
    expect(systemMsgs.length).toBeGreaterThanOrEqual(2);
  });

  it("言語リマインダーを最後のuserメッセージ直前に挿入する", () => {
    const msgs = [{ role: "user" as const, content: "テスト", isStreaming: false }];
    const result = buildMessagesForApi(msgs, "prompt", "AI");
    const lastUserIdx = result.findLastIndex((m) => m.role === "user");
    expect(result[lastUserIdx - 1].role).toBe("system");
    expect(result[lastUserIdx - 1].content).toContain("日本語");
  });

  it("assistant履歴からretry断片とrememberを除去する", () => {
    const msgs = [
      {
        role: "assistant",
        content:
          "失礼しました。再度挑戦します。<response><dialogue>古い返答</dialogue></response><remember>秘密</remember><response><dialogue>新しい返答</dialogue></response>",
        isStreaming: false,
      },
      { role: "user", content: "続けて", isStreaming: false },
    ] satisfies Parameters<typeof buildMessagesForApi>[0];
    const result = buildMessagesForApi(msgs, "prompt", "AI");

    expect(result[1].content).toBe("<response><dialogue>新しい返答</dialogue></response>");
    expect(result[1].content).not.toContain("remember");
    expect(result[1].content).not.toContain("失礼しました");
  });

  it("拒否・謝罪artifactを次回API送信用履歴から除外する", () => {
    const msgs = [
      { role: "user", content: "前の依頼", isStreaming: false },
      {
        role: "assistant",
        content:
          "<response><dialogue>申し訳ありません、これ以上の描写はできません。</dialogue></response>",
        isStreaming: false,
      },
      { role: "user", content: "もう一回送る", isStreaming: false },
    ] satisfies Parameters<typeof buildMessagesForApi>[0];
    const result = buildMessagesForApi(msgs, "prompt", "AI");
    const assistantMessages = result.filter((message) => message.role === "assistant");

    expect(assistantMessages).toHaveLength(0);
    expect(result.map((message) => message.content).join("\n")).not.toContain("申し訳ありません");
    expect(result.at(-1)).toEqual({ role: "user", content: "もう一回送る" });
  });

  it("API送信用の長すぎる履歴を上限内に丸める", () => {
    const longContent = `先頭${"あ".repeat(API_MESSAGE_CONTENT_MAX_LENGTH + 100)}末尾`;
    const result = buildMessagesForApi(
      [{ role: "assistant", content: longContent, isStreaming: false }],
      "prompt",
      "AI",
    );

    expect(result[1].content.length).toBe(API_MESSAGE_CONTENT_MAX_LENGTH);
    expect(result[1].content).toContain("末尾");
  });

  it("直前assistantの禁止定型句を最新user直前で禁止する", () => {
    const msgs: Parameters<typeof buildMessagesForApi>[0] = [
      {
        role: "assistant",
        content: "<response><action>背徳感と興奮が込み上げる。</action></response>",
        isStreaming: false,
      },
      { role: "user", content: "続けて", isStreaming: false },
    ];
    const result = buildMessagesForApi(msgs, "prompt", "AI");
    const lastUserIdx = result.findLastIndex((m) => m.role === "user");

    expect(result[lastUserIdx - 1].role).toBe("system");
    expect(result[lastUserIdx - 1].content).toContain("背徳感と興奮");
    expect(result[lastUserIdx - 1].content).toContain("絶対に同じフレーズを使うな");
  });

  it("禁止定型句がなければ反復リマインダーを追加しない", () => {
    const msgs: Parameters<typeof buildMessagesForApi>[0] = [
      {
        role: "assistant",
        content: "<response><action>指先が布地を掴む。</action></response>",
        isStreaming: false,
      },
      { role: "user", content: "続けて", isStreaming: false },
    ];
    const result = buildMessagesForApi(msgs, "prompt", "AI");

    expect(result.map((m) => m.content).join("\n")).not.toContain("Anti-repetition reminder");
  });
});

describe("findBannedRepeatedPhrases", () => {
  it("禁止定型句の部分一致を返す", () => {
    const result = findBannedRepeatedPhrases("背徳感と興奮が込み上げる。息を呑み、見つめる。");

    expect(result).toEqual(["背徳感と興奮", "息を呑み"]);
  });
});

describe("normalizeAssistantMessageContent", () => {
  it("最後の完全なresponseブロックだけを残す", () => {
    const result = normalizeAssistantMessageContent(
      "<response><dialogue>一つ目</dialogue></response>失礼しました。再度挑戦します。<response><dialogue>二つ目</dialogue></response>",
    );

    expect(result).toBe("<response><dialogue>二つ目</dialogue></response>");
  });

  it("streaming中に混入したinternalタグとprotocol markerを除去する", () => {
    const result = normalizeAssistantMessageContent(
      `<internal>debug</internal>
event: message
data: {"choices":[{"delta":{"content":"leak"}}]}
<thinking>hidden</thinking>
<|assistant|>
会話本文`,
    );

    expect(result).toBe("会話本文");
  });

  it("protocol marker lineを空行として残さない", () => {
    const result = normalizeAssistantMessageContent(`本文前
event: message
data: {"choices":[{"delta":{"content":"leak"}}]}
本文後`);

    expect(result).toBe(`本文前
本文後`);
  });

  it("ラッパー切り詰め時にタグ残骸を残さない", () => {
    const truncated = "<response><dialogue>やあ</dialogue><inner>y</inner";
    const result = normalizeAssistantMessageContent(truncated);
    expect(result).not.toMatch(/<\/?inner/);
    expect(result).not.toMatch(/<\/?response/);
    expect(result).not.toMatch(/<\/?dialogue/);
  });

  it("</inner のような > 欠落タグが平文フォールバックを汚染しない", () => {
    const result = normalizeAssistantMessageContent("彼女は微笑んだ</inner");
    expect(result).toBe("彼女は微笑んだ");
  });
});

describe("isRefusalArtifactAssistantContent", () => {
  it("XML内の拒否応答を検出する", () => {
    expect(
      isRefusalArtifactAssistantContent(
        "<response><dialogue>申し訳ありません、応じられません。</dialogue></response>",
      ),
    ).toBe(true);
  });

  it("通常のキャラ応答は拒否artifact扱いしない", () => {
    expect(
      isRefusalArtifactAssistantContent(
        "<response><action>指先が布地を掴む。</action><dialogue>「……続けて」</dialogue><inner>声が震える。</inner></response>",
      ),
    ).toBe(false);
  });
});

describe("buildRetryMessages", () => {
  it("判定メタ文言を出さずキャラクター本人としてリトライさせる", () => {
    const original = [{ role: "system" as const, content: "prompt" }];
    const result = buildRetryMessages(original, "bad response", { firstPerson: "あたし" });
    expect(result).toHaveLength(3);
    expect(result[1].role).toBe("assistant");
    expect(result[2].role).toBe("user");
    expect(result[2].content).toContain("キャラクター本人");
    expect(result[2].content).not.toContain("品質チェック");
    expect(result[2].content).toContain("あたし");
  });

  it("一人称未指定でも動作する", () => {
    const result = buildRetryMessages([{ role: "system" as const, content: "p" }], "resp", {});
    expect(result).toHaveLength(3);
  });

  it("cross-turn-repetition用の具体的な書き直し指示を含める", () => {
    const result = buildRetryMessages(
      [{ role: "system" as const, content: "p" }],
      "resp",
      {},
      "cross-turn-repetition",
    );
    expect(result[2].content).toContain("前回と同じ文");
    expect(result[2].content).toContain("完全に異なる表現");
  });
});
