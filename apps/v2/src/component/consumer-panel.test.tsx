import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ConsumerPanel } from "./consumer-panel";

const { memory, documentPanel, proactive } = vi.hoisted(() => ({
  memory: vi.fn(),
  documentPanel: vi.fn(),
  proactive: vi.fn(),
}));
vi.mock("./memory-manager", () => ({
  MemoryManager: ({ conversationId }: { conversationId: string }) => {
    memory(conversationId);
    return <p>記憶の合成scope: {conversationId}</p>;
  },
}));
vi.mock("./document-panel", () => ({
  DocumentPanel: ({
    characterId,
    conversationId,
  }: {
    characterId: string;
    conversationId: string | null;
  }) => {
    documentPanel(characterId, conversationId);
    return (
      <p>
        資料の合成scope: {characterId}/{conversationId ?? "未作成"}
      </p>
    );
  },
}));
vi.mock("./proactive-settings", () => ({
  ProactiveSettings: ({ characterId }: { characterId: string }) => {
    proactive(characterId);
    return <p>通知の合成scope: {characterId}</p>;
  },
}));

const prototype = HTMLDialogElement.prototype;
const originalShow = Object.getOwnPropertyDescriptor(prototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(prototype, "close");
beforeAll(() => {
  // jsdomはnative dialog APIを持たんため、実際のfocus trap/EscapeはChrome受入で確認する。
  Object.defineProperty(prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.open = true;
      this.querySelector("button")?.focus();
    },
  });
  Object.defineProperty(prototype, "close", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event("close"));
    },
  });
});
afterAll(() => {
  if (originalShow) Object.defineProperty(prototype, "showModal", originalShow);
  else Reflect.deleteProperty(prototype, "showModal");
  if (originalClose) Object.defineProperty(prototype, "close", originalClose);
  else Reflect.deleteProperty(prototype, "close");
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("会話の設定consumer mount", () => {
  it("閉じている間はdomainを起動せず、会話未作成は理由を示す", () => {
    render(<ConsumerPanel characterId="synthetic-A" conversationId={null} />);
    expect(memory).not.toHaveBeenCalled();
    expect(documentPanel).not.toHaveBeenCalled();
    expect(proactive).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "会話の設定" }));
    expect(screen.getByRole("dialog", { name: "会話の設定" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("最初の会話後に記憶を管理できます");
    expect(memory).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "自発通知" }));
    expect(screen.getByText("通知の合成scope: synthetic-A")).toBeInTheDocument();
    expect(proactive).toHaveBeenLastCalledWith("synthetic-A");
  });

  it("記憶と資料に確認済み会話IDを渡し、scope更新と閉じる操作を保つ", () => {
    const { rerender } = render(
      <ConsumerPanel characterId="synthetic-A" conversationId="synthetic-room-1" />,
    );
    const trigger = screen.getByRole("button", { name: "会話の設定" });
    fireEvent.click(trigger);
    expect(screen.getByText("記憶の合成scope: synthetic-room-1")).toBeInTheDocument();
    rerender(<ConsumerPanel characterId="synthetic-A" conversationId="synthetic-room-2" />);
    expect(screen.queryByText("記憶の合成scope: synthetic-room-1")).not.toBeInTheDocument();
    expect(screen.getByText("記憶の合成scope: synthetic-room-2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "資料" }));
    expect(documentPanel).toHaveBeenLastCalledWith("synthetic-A", "synthetic-room-2");
    fireEvent.click(screen.getByRole("button", { name: "会話の設定を閉じる" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
