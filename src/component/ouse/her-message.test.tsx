import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChatMessage } from "@/store/chat-store";

import { HerMessage } from "./her-message";

const baseMessage: ChatMessage = {
  id: "msg-1",
  role: "assistant",
  content: "<response><dialogue>「テスト」</dialogue></response>",
};

describe("HerMessage 本文の表示順", () => {
  afterEach(cleanup);

  // 実測(2026-08-16 vlong-dogfood): モデルはaction/dialogueを交互に複数組出す。
  // 種別ごとにまとめて「地の文まとめ→台詞まとめ」の2段に描画すると、
  // モデルが書いた地の文→台詞→地の文→台詞…という場面の時系列が画面上で壊れる。
  it("action/dialogueが交互に複数組出た場合、出現順のまま表示する", () => {
    const message: ChatMessage = {
      id: "msg-order",
      role: "assistant",
      content:
        "<response><action>アクション1</action><dialogue>台詞1</dialogue><action>アクション2</action><dialogue>台詞2</dialogue></response>",
    };
    const { container } = render(<HerMessage message={message} isStreaming={false} />);

    const text = container.textContent ?? "";
    const idx1 = text.indexOf("アクション1");
    const idxD1 = text.indexOf("台詞1");
    const idx2 = text.indexOf("アクション2");
    const idxD2 = text.indexOf("台詞2");

    expect([idx1, idxD1, idx2, idxD2].every((i) => i >= 0)).toBe(true);
    expect(idx1).toBeLessThan(idxD1);
    expect(idxD1).toBeLessThan(idx2);
    expect(idx2).toBeLessThan(idxD2);
  });
});

// good / イマイチ / コピー / リンク / 読み上げは 2026-08-19 に局長判断で YAGNI 撤去した。
// 撮り直し（再生成）だけが残っとる。撤去した分を見とったテストはここから消えとる。
describe("HerMessage の当たり判定", () => {
  it("送信失敗の再試行は 44px の当たりを持つ(見た目の文字サイズは据え置き)", () => {
    render(
      <HerMessage
        message={{ ...baseMessage, error: true }}
        isStreaming={false}
        onRegenerate={vi.fn()}
      />,
    );

    const retry = screen.getByRole("button", { name: "再試行" });
    expect(retry.className).toContain("before:min-h-[44px]");
    expect(retry.className).toContain("before:min-w-[44px]");
    // 見た目は据え置き（padding を膨らませて解決してへんこと）
    expect(retry.style.padding).toBe("2px 4px");
  });
});

// D13: 三点リーダーを少し下げる演出が position:relative + top オフセットで実装されとった。
// これは見た目の位置だけを動かすペイント側のハックで、テキスト選択の矩形計算に正しく
// 反映されないブラウザがあり、選択がこの範囲へ掛かるとネイティブのコピー/ペーストメニューが
// 実際の文字より上にズレて出る典型パターンになる。vertical-align はレイアウトそのものを
// 動かすため、選択範囲の矩形も正しく追従する。
describe("HerMessage 三点リーダーの下げ処理 (D13)", () => {
  afterEach(cleanup);

  it("position:relativeのペイントオフセットではなくvertical-alignでレイアウトごと下げる", () => {
    const message: ChatMessage = {
      id: "msg-ellipsis",
      role: "assistant",
      content: "<response><dialogue>まって…だめ…</dialogue></response>",
    };
    const { container } = render(<HerMessage message={message} isStreaming={false} />);

    const ellipsisSpans = Array.from(container.querySelectorAll("span")).filter((span) =>
      /^…+$/u.test(span.textContent ?? ""),
    );
    expect(ellipsisSpans.length).toBeGreaterThan(0);
    for (const span of ellipsisSpans) {
      expect(span.style.position).not.toBe("relative");
      expect(span.style.top).toBe("");
      expect(span.style.verticalAlign).toBe("-0.18em");
    }
  });
});
