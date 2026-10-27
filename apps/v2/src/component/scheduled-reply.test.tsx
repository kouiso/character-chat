import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ScheduledReply } from "./scheduled-reply";

import type { ChunkDeliverySnapshot } from "../lib/chunk-delivery";

const BASE = 1_800_000_000_000;
const snapshot = (): ChunkDeliverySnapshot => ({
  conversationId: "synthetic",
  turn: 1,
  serverNow: BASE,
  chunks: [
    { seq: 2, text: "third", scheduledAt: BASE + 2_000 },
    { seq: 0, text: "first", scheduledAt: BASE + 1_000 },
    { seq: 1, text: "second", scheduledAt: BASE + 1_500 },
  ],
});

describe("ScheduledReply", () => {
  let elapsed: number;

  beforeEach(() => {
    elapsed = 0;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(performance, "now").mockImplementation(() => elapsed);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("hides future text and displays each due chunk in sequence", () => {
    render(<ScheduledReply characterName="案内役" snapshot={snapshot()} />);
    expect(screen.getByRole("status")).toHaveTextContent("入力中");
    expect(screen.queryByText("first")).not.toBeInTheDocument();
    act(() => {
      elapsed = 1_000;
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByText("first")).toBeInTheDocument();
    expect(screen.queryByText("second")).not.toBeInTheDocument();
    act(() => {
      elapsed = 2_000;
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getAllByText(/^(first|second|third)$/).map((node) => node.textContent)).toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("ignores a skewed device clock and wall clock changes", () => {
    const wall = vi.spyOn(Date, "now").mockReturnValue(BASE + 86_400_000);
    render(<ScheduledReply characterName="案内役" snapshot={snapshot()} />);
    expect(screen.queryByText("first")).not.toBeInTheDocument();
    wall.mockReturnValue(BASE - 86_400_000);
    act(() => {
      elapsed = 1_000;
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByText("first")).toBeInTheDocument();
    expect(screen.queryByText("second")).not.toBeInTheDocument();
  });

  it.each(["focus", "pageshow", "visibilitychange"])(
    "catches up immediately after %s without waiting for throttled timers",
    (eventName) => {
      render(<ScheduledReply characterName="案内役" snapshot={snapshot()} />);
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
      act(() => {
        elapsed = 60_000;
        (eventName === "visibilitychange" ? document : window).dispatchEvent(new Event(eventName));
      });
      expect(screen.getAllByText(/^(first|second|third)$/)).toHaveLength(3);
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    },
  );

  it("shows all elapsed chunks immediately when reopened", () => {
    const reopened = { ...snapshot(), serverNow: BASE + 60_000 };
    render(<ScheduledReply characterName="案内役" snapshot={reopened} />);
    expect(screen.getAllByText(/^(first|second|third)$/)).toHaveLength(3);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("deduplicates replayed chunks without postponing an unchanged delivery", () => {
    const data = snapshot();
    data.chunks.push(data.chunks[0]);
    const { rerender } = render(<ScheduledReply characterName="案内役" snapshot={data} />);
    elapsed = 500;
    rerender(
      <ScheduledReply characterName="案内役" snapshot={{ ...data, chunks: [...data.chunks] }} />,
    );
    act(() => {
      elapsed = 1_000;
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getAllByText("first")).toHaveLength(1);
    act(() => {
      elapsed = 2_000;
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getAllByText("third")).toHaveLength(1);
  });

  it("keeps visible chunks and deadlines when replayed keys and chunks change order", () => {
    const data = snapshot();
    const { rerender } = render(<ScheduledReply characterName="案内役" snapshot={data} />);
    act(() => {
      elapsed = 1_000;
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByText("first")).toBeInTheDocument();
    const reordered: ChunkDeliverySnapshot = {
      chunks: [...data.chunks].reverse().map((chunk) => ({
        text: chunk.text,
        scheduledAt: chunk.scheduledAt,
        seq: chunk.seq,
      })),
      serverNow: data.serverNow,
      turn: data.turn,
      conversationId: data.conversationId,
    };
    reordered.chunks.push({ ...reordered.chunks[0] });
    rerender(<ScheduledReply characterName="案内役" snapshot={reordered} />);
    expect(screen.getAllByText("first")).toHaveLength(1);
    act(() => {
      elapsed = 1_500;
      vi.advanceTimersByTime(500);
    });
    expect(screen.getAllByText("second")).toHaveLength(1);
    expect(screen.queryByText("third")).not.toBeInTheDocument();
  });

  it("遅延した同じ配送のサーバ時刻で表示と次の期限を巻き戻さない", () => {
    const data = snapshot();
    const { rerender } = render(<ScheduledReply characterName="案内役" snapshot={data} />);
    act(() => {
      elapsed = 1_000;
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByText("first")).toBeInTheDocument();
    rerender(<ScheduledReply characterName="案内役" snapshot={{ ...data, serverNow: BASE + 1 }} />);
    expect(screen.getByText("first")).toBeInTheDocument();
    act(() => {
      elapsed = 1_500;
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByText("second")).toBeInTheDocument();
    expect(screen.queryByText("third")).not.toBeInTheDocument();
  });

  it("同じ配送の新しいサーバ時刻で未表示の期限を即座に追いつく", () => {
    const data = snapshot();
    const { rerender } = render(<ScheduledReply characterName="案内役" snapshot={data} />);
    rerender(
      <ScheduledReply characterName="案内役" snapshot={{ ...data, serverNow: BASE + 60_000 }} />,
    );
    expect(screen.getAllByText(/^(first|second|third)$/)).toHaveLength(3);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("replaces a different turn without leaking the previous turn's text", () => {
    const { rerender } = render(
      <ScheduledReply
        characterName="案内役"
        snapshot={{ ...snapshot(), serverNow: BASE + 5_000 }}
      />,
    );
    expect(screen.getByText("first")).toBeInTheDocument();
    rerender(
      <ScheduledReply
        characterName="案内役"
        snapshot={{
          conversationId: "synthetic",
          turn: 2,
          serverNow: BASE,
          chunks: [{ seq: 0, text: "new", scheduledAt: BASE + 500 }],
        }}
      />,
    );
    expect(screen.queryByText("first")).not.toBeInTheDocument();
    expect(screen.queryByText("new")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("入力中");
  });

  it("handles empty replies and legacy unscheduled chunks", () => {
    const { rerender } = render(
      <ScheduledReply characterName="案内役" snapshot={{ ...snapshot(), chunks: [] }} />,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    rerender(
      <ScheduledReply
        characterName="案内役"
        snapshot={{ ...snapshot(), chunks: [{ seq: 0, text: "legacy", scheduledAt: null }] }}
      />,
    );
    expect(screen.getByText("legacy")).toBeInTheDocument();
  });

  it("予定時刻後に各chunkを描写・台詞・心の声として表示する", () => {
    const { container } = render(
      <ScheduledReply
        characterName="案内役"
        snapshot={{
          conversationId: "synthetic",
          turn: 1,
          serverNow: BASE,
          chunks: [
            {
              seq: 0,
              text: "<action>地図を開く。</action><dialogue>出発しよう。</dialogue><inner>楽しみ。</inner>",
              scheduledAt: BASE + 500,
            },
          ],
        }}
      />,
    );
    expect(screen.queryByRole("group", { name: "台詞" })).not.toBeInTheDocument();
    act(() => {
      elapsed = 500;
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByRole("group", { name: "描写" })).toHaveTextContent("地図を開く。");
    expect(screen.getByRole("group", { name: "台詞" })).toHaveTextContent("出発しよう。");
    expect(screen.getByRole("group", { name: "心の声" })).toHaveTextContent("楽しみ。");
    expect(container.textContent).not.toContain("<action>");
  });

  it("removes timers and resume listeners on unmount", () => {
    const removeDocument = vi.spyOn(document, "removeEventListener");
    const removeWindow = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<ScheduledReply characterName="案内役" snapshot={snapshot()} />);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(removeDocument).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    expect(removeWindow).toHaveBeenCalledWith("pageshow", expect.any(Function));
    expect(removeWindow).toHaveBeenCalledWith("focus", expect.any(Function));
  });
});
