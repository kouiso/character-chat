import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { writeChatSession } from "../lib/chat-session";
import { makeFixtureReply, readFixtureChatRequest } from "../test/chat-fixture";

import { ChatView } from "./chat-view";

vi.mock("./consumer-panel", () => ({
  ConsumerPanel: ({
    characterId,
    conversationId,
  }: {
    characterId: string;
    conversationId: string | null;
  }) => (
    <output aria-label="合成consumer scope">
      {characterId}/{conversationId ?? "未確認"}
    </output>
  ),
}));
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const scope = () => screen.getByLabelText("合成consumer scope");

describe("consumer会話IDの接続", () => {
  it("初回の送信UUIDだけでは設定を有効にしない", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 503 })),
    );
    render(<ChatView characterId="synthetic-A" characterName="合成A" />);
    expect(scope()).toHaveTextContent("synthetic-A/未確認");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "合成の質問" } });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));
    await screen.findByRole("alert");
    expect(scope()).toHaveTextContent("synthetic-A/未確認");
  });

  it("履歴の検証成功後だけ復元し、キャラクターを替えたら旧scopeを消す", async () => {
    writeChatSession("synthetic-A", {
      version: 1,
      conversationId: "synthetic-room",
      pending: null,
    });
    let finish: ((value: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    const view = render(<ChatView characterId="synthetic-A" characterName="合成A" />);
    expect(scope()).toHaveTextContent("synthetic-A/未確認");
    await act(async () => {
      finish?.(
        Response.json({ conversationId: "synthetic-room", turn: 1, history: [], deliveries: [] }),
      );
    });
    expect(scope()).toHaveTextContent("synthetic-A/synthetic-room");
    view.rerender(<ChatView characterId="synthetic-B" characterName="合成B" />);
    expect(scope()).toHaveTextContent("synthetic-B/未確認");
  });

  it("初回返信の保存readback成功で設定会話を更新する", async () => {
    let completed: ReturnType<typeof makeFixtureReply> | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        if (init.method !== "POST") return Response.json(completed?.history);
        completed = makeFixtureReply(
          readFixtureChatRequest(init),
          [{ seq: 0, text: "合成の返信", scheduledAt: 1000 }],
          2000,
        );
        return completed.response();
      }),
    );
    render(<ChatView characterId="synthetic-A" characterName="合成A" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "合成の質問" } });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));
    await screen.findByText("合成の返信");
    await waitFor(() =>
      expect(scope()).toHaveTextContent(`synthetic-A/${completed?.delivery.conversationId}`),
    );
  });

  it("404の明示入力再開で旧設定scopeを解除する", async () => {
    const pending = {
      characterId: "synthetic-A",
      conversationId: "synthetic-room",
      requestId: "synthetic-failed",
      text: "合成の失敗入力",
      baseTurn: 1,
      terminalError: "合成の処理終了",
    };
    writeChatSession("synthetic-A", {
      version: 1,
      conversationId: pending.conversationId,
      pending,
    });
    let reads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        ++reads === 1
          ? Response.json({
              conversationId: pending.conversationId,
              turn: 1,
              history: [],
              deliveries: [],
            })
          : new Response("", { status: 404 }),
      ),
    );
    render(<ChatView characterId="synthetic-A" characterName="合成A" />);
    await screen.findByRole("button", { name: "入力をやり直す" });
    expect(scope()).toHaveTextContent("synthetic-A/synthetic-room");
    fireEvent.click(screen.getByRole("button", { name: "入力をやり直す" }));
    await waitFor(() => expect(screen.getByRole("textbox")).toBeEnabled());
    expect(scope()).toHaveTextContent("synthetic-A/未確認");
  });
});
