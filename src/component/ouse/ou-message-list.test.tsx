import { createRef } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChatMessage } from "@/store/chat-store";

import { OuseMessageList } from "./ou-message-list";

vi.mock("@/lib/api", () => ({
  listConversations: vi.fn(async () => []),
  apiFetch: vi.fn(async () => new Response(null, { status: 404 })),
}));

afterEach(cleanup);

const noop = () => {};
const asyncNoop = async () => {};

const renderList = (messages: ChatMessage[], imageGenerating: string[] = []) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OuseMessageList
        greetingContent={null}
        bubbleCharacter={undefined}
        visibleMessages={messages}
        handleFeedback={asyncNoop}
        handleRegenerate={asyncNoop}
        handleRetrySend={noop}
        handleImageClick={noop}
        imageGeneratingMessageIds={new Set(imageGenerating)}
        activeCharId="char-1"
        isOnline
        scrollRef={createRef<HTMLDivElement>()}
        onScroll={noop}
        onScrollTouchStart={noop}
        onScrollTouchEnd={noop}
      />
    </QueryClientProvider>,
  );
};

const streaming: ChatMessage = {
  id: "a1",
  role: "assistant",
  content: "<dialogue>おかえ",
  isStreaming: true,
};

const settled: ChatMessage = {
  id: "a1",
  role: "assistant",
  content: "<dialogue>おかえりなさい</dialogue>",
  isStreaming: false,
};

describe("OuseMessageList の読み上げ", () => {
  it("スクロール領域は log として出るが、自身は読み上げん", () => {
    renderList([settled]);

    const log = screen.getByRole("log", { name: "会話" });
    // role="log" の既定 aria-live は polite。切っておかんとストリーミングの
    // 差分が全部読み上げ対象になる。
    expect(log).toHaveAttribute("aria-live", "off");
  });

  it("生成中は log が aria-busy になる", () => {
    renderList([streaming]);
    expect(screen.getByRole("log")).toHaveAttribute("aria-busy", "true");

    cleanup();
    renderList([settled]);
    expect(screen.getByRole("log")).toHaveAttribute("aria-busy", "false");
  });

  it("画像生成中も log が aria-busy になる", () => {
    renderList([settled], ["a1"]);
    expect(screen.getByRole("log")).toHaveAttribute("aria-busy", "true");
  });

  it("ライブリージョンは log の外にあり、途中の本文を持たん", () => {
    renderList([streaming]);

    const status = screen.getByRole("status");
    expect(screen.getByRole("log")).not.toContainElement(status);
    expect(status).not.toHaveTextContent("おかえ");
  });
});
