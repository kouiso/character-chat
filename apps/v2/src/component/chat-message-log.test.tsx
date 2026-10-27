import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatMessageLog } from "./chat-message-log";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ChatMessageLog", () => {
  it("画面高が縮んでも末尾追従を維持し、履歴閲覧中は位置を保持する", () => {
    let resize: (() => void) | undefined;
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    const { unmount } = render(<ChatMessageLog busy={false}>合成の長文</ChatMessageLog>);
    const log = screen.getByRole("log", { name: "会話のメッセージ" });
    Object.defineProperties(log, {
      scrollHeight: { value: 1200 },
      clientHeight: { configurable: true, value: 240 },
    });
    resize?.();
    expect(log.scrollTop).toBe(960);

    log.scrollTop = 100;
    fireEvent.scroll(log);
    Object.defineProperty(log, "clientHeight", { value: 340 });
    resize?.();
    expect(log.scrollTop).toBe(100);
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("末尾を読んでいる間は追加の返信とストリームの伸長へ追従する", () => {
    const { rerender } = render(<ChatMessageLog busy={false}>合成の最初の本文</ChatMessageLog>);
    const log = screen.getByRole("log", { name: "会話のメッセージ" });
    Object.defineProperties(log, {
      scrollHeight: { configurable: true, value: 1200 },
      clientHeight: { value: 400 },
    });

    rerender(<ChatMessageLog busy>合成の本文の続き</ChatMessageLog>);
    expect(log.scrollTop).toBe(800);
    expect(log).toHaveAttribute("aria-busy", "true");

    Object.defineProperty(log, "scrollHeight", { value: 1600 });
    rerender(<ChatMessageLog busy={false}>確定した合成の本文の続き</ChatMessageLog>);
    expect(log.scrollTop).toBe(1200);
    expect(log).toHaveAttribute("aria-busy", "false");
  });

  it("履歴を読んでいる間は位置を奪わず、末尾に戻ると追従を再開する", () => {
    const { rerender } = render(<ChatMessageLog busy={false}>合成の履歴</ChatMessageLog>);
    const log = screen.getByRole("log", { name: "会話のメッセージ" });
    Object.defineProperties(log, {
      scrollHeight: { configurable: true, value: 1200 },
      clientHeight: { value: 400 },
    });
    log.scrollTop = 150;
    fireEvent.scroll(log);

    Object.defineProperty(log, "scrollHeight", { value: 1600 });
    rerender(<ChatMessageLog busy>合成の追加本文</ChatMessageLog>);
    expect(log.scrollTop).toBe(150);

    log.scrollTop = 1200;
    fireEvent.scroll(log);
    Object.defineProperty(log, "scrollHeight", { value: 2000 });
    rerender(<ChatMessageLog busy={false}>合成の追加本文が確定</ChatMessageLog>);
    expect(log.scrollTop).toBe(1600);
    expect(log).toHaveAttribute("tabindex", "0");
  });
});
