import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ChatMessage } from "./chat-message";

describe("会話の表示", () => {
  afterEach(cleanup);
  it("描写と台詞を分け、心の声は開いた時に読める", () => {
    const { container } = render(
      <ChatMessage content="<response><action>本を開く。</action><dialogue>こんにちは。</dialogue><inner>何を読もうかな。</inner></response>" />,
    );
    expect(screen.getByText("本を開く。")).toHaveClass("v2-action");
    expect(screen.getByText("こんにちは。")).toHaveClass("v2-dialogue");
    const details = container.querySelector("details");
    expect(details).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("心の声"));
    expect(container.textContent).not.toContain("<action>");
  });
  it("本文をHTMLとして実行しない", () => {
    const { container } = render(
      <ChatMessage content={"前置き<dialogue><img src=x onerror=alert(1)></dialogue>後置き"} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("前置き")).toBeInTheDocument();
    expect(screen.getByText("後置き")).toBeInTheDocument();
  });
});
