import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ChatMessage } from "./chat-message";

afterEach(cleanup);

describe("ChatMessage", () => {
  it.each(["  合成の本文\n末尾  ", "<dialogue>  合成の本文\n末尾  </dialogue>"])(
    "本文のインデントと末尾空白を保持する: %s",
    (text) => {
      render(<ChatMessage role="assistant" characterName="案内役" text={text} />);
      expect(screen.getByRole("group", { name: "台詞" }).textContent).toBe("  合成の本文\n末尾  ");
    },
  );

  it("描写・台詞・心の声を繰り返しも含めて元の順番で表示する", () => {
    const { container } = render(
      <ChatMessage
        role="assistant"
        characterName="サンプル案内役"
        text={
          "<response><scene>合成の公園</scene><action>ベンチへ歩く。</action>" +
          "<dialogue>「ここで休もう」</dialogue><inner>風が心地よい。</inner>" +
          "<action>地図を開く。</action><dialogue>「次は図書館へ」</dialogue></response>"
        }
      />,
    );

    expect(screen.getByRole("group", { name: "状況" })).toHaveTextContent("合成の公園");
    expect(screen.getByRole("group", { name: "心の声" })).toHaveTextContent("風が心地よい。");
    expect(
      [...container.querySelectorAll(".v2-message-layer")].map((layer) => layer.textContent),
    ).toEqual([
      "合成の公園",
      "ベンチへ歩く。",
      "「ここで休もう」",
      "風が心地よい。",
      "地図を開く。",
      "「次は図書館へ」",
    ]);
    expect(container.textContent).not.toContain("<response>");
  });

  it("長台詞・改行・結合絵文字を省略せず保持する", () => {
    const text = `「${"ゆっくり地図を確かめよう。".repeat(80)}\n${"👩🏽‍🚀🌸🏳️‍🌈".repeat(40)}」`;
    render(
      <ChatMessage role="assistant" characterName="案内役" text={`<dialogue>${text}</dialogue>`} />,
    );

    expect(screen.getByRole("group", { name: "台詞" }).textContent).toBe(text);
  });

  it("ユーザーの入力は制御タグも含めてそのまま表示する", () => {
    const text = "<action>文字列です</action>\n🙂 <script>alert(1)</script>";
    const { container } = render(<ChatMessage role="user" characterName="案内役" text={text} />);

    expect(screen.getByRole("group", { name: "あなたのメッセージ" }).textContent).toBe(text);
    expect(container.querySelector("script")).toBeNull();
    expect(screen.queryByRole("group", { name: "描写" })).not.toBeInTheDocument();
  });

  it("タグなしの既存本文と未知のタグを欠落させず安全に表示する", () => {
    const text = '2 < 3。<img src="x" onerror="alert(1)">\n通常の本文。';
    const { container } = render(
      <ChatMessage role="assistant" characterName="案内役" text={text} />,
    );

    expect(screen.getByRole("group", { name: "台詞" }).textContent).toBe(text);
    expect(container.querySelector("img")).toBeNull();
  });

  it("途中のタグを出さず、未閉鎖の層も次の token へつなげる", () => {
    const { rerender, container } = render(
      <ChatMessage role="assistant" characterName="案内役" streaming text="<respon" />,
    );
    expect(container.textContent).toBe("案内役");

    rerender(
      <ChatMessage
        role="assistant"
        characterName="案内役"
        streaming
        text="<response><action>地図を開く。</action><dia"
      />,
    );
    expect(screen.getByRole("group", { name: "描写" })).toHaveTextContent("地図を開く。");
    expect(container.textContent).not.toContain("<dia");

    rerender(
      <ChatMessage
        role="assistant"
        characterName="案内役"
        streaming
        text="<response><action>地図を開く。</action><dialogue>「行こう👩🏽‍🚀」</dialogue><inner>楽しみ"
      />,
    );
    expect(screen.getByRole("group", { name: "台詞" })).toHaveTextContent("「行こう👩🏽‍🚀」");
    expect(screen.getByRole("group", { name: "心の声" })).toHaveTextContent("楽しみ");

    rerender(<ChatMessage role="assistant" characterName="案内役" text="未完の文字列 <dia" />);
    expect(screen.getByRole("group", { name: "台詞" }).textContent).toBe("未完の文字列 <dia");
  });

  it("空タグだけの層は作らず、構造化本文の前後も失わない", () => {
    const { container } = render(
      <ChatMessage
        role="assistant"
        characterName="案内役"
        text="前置き<response><action> </action><inner></inner><narration>道はまっすぐ。</narration></response>後書き"
      />,
    );
    expect(screen.queryByRole("group", { name: "描写" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "心の声" })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "地の文" })).toHaveTextContent("道はまっすぐ。");
    expect(container.textContent).toBe("案内役前置き道はまっすぐ。後書き");
  });
});
