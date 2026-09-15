import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HerMessage } from "./her-message";

// 局長 2026-08-19「ボタンいっぱい並んでるところ、yagni で一旦省きたいって言ったのに
// 省いてくれてない」。チップ列は 2026-08-17 に YAGNI 撤去済み（chips-panel.tsx）やのに、
// キャラの発言の下の列（good / イマイチ / コピー / 再生成 / リンク / 読み上げ）は残っとった。
//
// 読んで続けるのに要るのは「もう一回書かせる」だけ。残りは画面から外す。

const message = {
  id: "m1",
  role: "assistant" as const,
  content:
    "<response><action>指先が止まる。</action><dialogue>「あの…」</dialogue><inner>こわい</inner></response>",
};

const renderMessage = () =>
  render(
    <HerMessage
      message={message as never}
      isStreaming={false}
      onFeedback={vi.fn()}
      onRegenerate={vi.fn()}
    />,
  );

describe("キャラの発言の下のボタン列", () => {
  it("再生成は残す", () => {
    renderMessage();
    expect(screen.getByRole("button", { name: "再生成" })).toBeInTheDocument();
  });

  it.each(["good", "イマイチ", "コピー", "この発言へのリンク", "読み上げ"])(
    "%s は出さん",
    (label) => {
      renderMessage();
      expect(screen.queryByRole("button", { name: label })).toBeNull();
    },
  );

  it("学習の注記も出さん（押す先が無いのに説明だけ残る）", () => {
    renderMessage();
    expect(screen.queryByText(/こういう返しが好き/)).toBeNull();
  });
});
