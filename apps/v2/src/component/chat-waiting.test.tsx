import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatWaiting } from "./chat-waiting";

describe("ChatWaiting", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("返信を待っている間は「作成中」と経過秒数を出し、60秒を超えても崩れない", () => {
    vi.useFakeTimers();
    render(<ChatWaiting phase="writing" />);

    expect(screen.getByText("作成中")).toBeInTheDocument();
    expect(screen.getByText("0秒")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByText("3秒")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(58000);
    });
    expect(screen.getByText("61秒")).toBeInTheDocument();
  });
});
