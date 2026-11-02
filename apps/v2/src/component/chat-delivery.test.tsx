import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatView } from "./chat-view";

const chunks = [
  { seq: 0, text: "<dialogue>最初の返事</dialogue>", scheduledAt: 2_000 },
  { seq: 1, text: "<dialogue>続きの返事</dialogue>", scheduledAt: 4_000 },
];
const history = (serverTime = 1_000) => ({
  turn: 2,
  serverTime,
  history: [{ role: "assistant", content: chunks.map((chunk) => chunk.text).join("\n\n"), chunks }],
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
  vi.setSystemTime(new Date("2050-01-01"));
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("予定時刻での返信表示", () => {
  it("時計がずれた端末でも早出しせず、時刻経過とタブ復帰で期限済みの塊を出す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(history())),
    );
    await act(async () => {
      render(<ChatView characterId="a" characterName="案内役" initialConversationId="conv" />);
    });
    expect(screen.getByRole("status")).toHaveTextContent("入力中");
    expect(document.querySelectorAll(".v2-bubble.assistant")).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });
    expect(screen.queryByText("最初の返事")).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByText("最初の返事")).toBeInTheDocument();
    expect(screen.queryByText("続きの返事")).not.toBeInTheDocument();
    vi.setSystemTime(new Date("1990-01-01"));
    fireEvent.focus(window);
    expect(screen.queryByText("続きの返事")).not.toBeInTheDocument();

    vi.spyOn(performance, "now").mockReturnValue(60_000);
    fireEvent(document, new Event("visibilitychange"));
    expect(screen.getByText("続きの返事")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeEnabled();
  });

  it("開き直した時は過ぎた分を待たずに全部表示する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(history(60_000))),
    );
    await act(async () => {
      render(<ChatView characterId="a" characterName="案内役" initialConversationId="conv" />);
    });
    expect(screen.getByText("最初の返事")).toBeInTheDocument();
    expect(screen.getByText("続きの返事")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("SSEの本文が届いても、保存済みの予定を読む前には表示しない", async () => {
    let finishHistory: (response: Response) => void = () => {};
    const pendingHistory = new Promise<Response>((resolve) => {
      finishHistory = resolve;
    });
    const chunk = {
      type: "chunk",
      seq: 0,
      text: chunks[0].text,
      attempt: 1,
      preExtend: false,
      judge: {
        ok: true,
        reasons: [],
        warnings: [],
        checks: {
          ngram: { ok: true, ratio: 0, matchedPhrases: [], exactRepeat: false },
          nearDuplicate: { ok: true, matches: [] },
          voice: { ok: true },
          format: { ok: true },
          empty: { ok: true },
        },
      },
    };
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "POST"
        ? new Response(
            `event: chunk\ndata: ${JSON.stringify(chunk)}\n\nevent: done\ndata: {"conversationId":"conv","turn":1,"generationId":null}\n\n`,
          )
        : pendingHistory,
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<ChatView characterId="a" characterName="案内役" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "質問です" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "送信" }));
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("最初の返事")).not.toBeInTheDocument();
    await act(async () => {
      finishHistory(Response.json(history()));
    });
    expect(screen.queryByText("最初の返事")).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(screen.getByText("最初の返事")).toBeInTheDocument();
  });
});
