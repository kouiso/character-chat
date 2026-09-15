import { describe, expect, it } from "vitest";

import {
  buildConversationFallbackTitle,
  sanitizeConversationSnippet,
  shouldReplaceDefaultConversationTitle,
} from "./conversation-summary";

describe("conversation summary helpers", () => {
  it("strips XML tags and truncates previews by characters", () => {
    expect(
      sanitizeConversationSnippet(
        "<response><action>肩を抱き寄せる</action><dialogue>今日はどうしたの？</dialogue></response>",
        12,
      ),
    ).toBe("肩を抱き寄せる 今日はど");
  });

  it("drops empty and image placeholder previews", () => {
    expect(sanitizeConversationSnippet("   ")).toBeNull();
    expect(sanitizeConversationSnippet("画像を生成中... (2/3)")).toBeNull();
  });

  it("builds fallback titles from the first meaningful user message", () => {
    expect(buildConversationFallbackTitle("今日は映画の話をしよう。おすすめは？", null, 10)).toBe(
      "今日は映画の話をしよ",
    );
  });

  it("keeps multilingual, emoji, and RTL text intact while truncating by character", () => {
    expect(buildConversationFallbackTitle("こんばんは🌙 مرحبا、今日はどうする？", null, 18)).toBe(
      "こんばんは🌙 مرحبا、今日はどう",
    );
  });

  it("uses a stable short title for empty conversations or placeholder-only content", () => {
    expect(buildConversationFallbackTitle("画像を生成中... (1/1)", null, 10)).toBe("会話");
  });

  it("caps very long fallback titles without splitting surrogate pairs", () => {
    const title = buildConversationFallbackTitle("好き".repeat(100) + "🌙", null, 30);
    expect(Array.from(title)).toHaveLength(30);
    expect(title).toBe("好き".repeat(15));
  });

  it("only replaces missing/default titles", () => {
    expect(shouldReplaceDefaultConversationTitle("新しい会話")).toBe(true);
    expect(shouldReplaceDefaultConversationTitle(null)).toBe(true);
    expect(shouldReplaceDefaultConversationTitle("夜行バスでの邂逅")).toBe(false);
  });
});

describe("buildConversationFallbackTitle — 会話タイトルの切り出し", () => {
  // slice(0, 40) はコードユニットで切るので 40 文字目の絵文字が割れる。
  it("40 文字目が絵文字でも壊れた文字を残さん", () => {
    const text = "あ".repeat(39) + "🌙";
    expect("あ".repeat(39).length + 1).toBe(40);
    expect(text.slice(0, 40).endsWith("\ud83c")).toBe(true);
    expect(buildConversationFallbackTitle(text)).not.toMatch(/[\uD800-\uDBFF]$/);
  });

  it("改行と連続スペースを畳む", () => {
    expect(buildConversationFallbackTitle("今日は\n\n  映画の話")).toBe("今日は 映画の話");
  });
});
