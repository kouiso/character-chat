import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChatView } from "./chat-view";

describe("ChatView", () => {
  it("キャラ名と入力フォームを描画する", () => {
    render(<ChatView characterId="char-koharu-ex" characterName="小春" />);

    expect(screen.getByText("小春")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("メッセージを入力")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "送信" })).toBeDisabled();
  });
});
