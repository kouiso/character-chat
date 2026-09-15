import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "@/lib/api";
import { addLogSink, type LogEntry } from "@/lib/logger";
import { getFallbackSuggestions } from "@/lib/suggestion-fallback";
import { useCharacterSettingsStore } from "@/store/character-settings-store";
import { type ChatMessage, useChatStore } from "@/store/chat-store";
import { useSettingsStore } from "@/store/settings-store";

import { OuseComposer } from "./ouse-composer";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof api>();
  return { ...actual, fetchReplySuggestions: vi.fn() };
});

const CHARACTER_ID = "char-1";
const CONVERSATION_ID = "conv-1";

const renderComposer = () =>
  render(
    <OuseComposer
      onSend={vi.fn()}
      onSendDirective={vi.fn()}
      onImageGenerate={vi.fn()}
      isLoading={false}
      characterName="霜月鈴"
      characterId={CHARACTER_ID}
      conversationId={CONVERSATION_ID}
    />,
  );

const suggestChip = () => screen.getByRole("button", { name: "なんて言う？" });

// 場面が erotic だと読ませる履歴。フェーズ別の代替候補が選ばれることを見るため。
const EROTIC_HISTORY: ChatMessage[] = [
  { id: "u1", role: "user", content: "服を脱がせて、そのまま奥まで挿れて。" },
  { id: "a1", role: "assistant", content: "「……ん、っ」腰を押し付けて、濡れた音を立てる。" },
];

describe("返信候補が失敗した時の代替候補", () => {
  let entries: LogEntry[];
  let removeSink: () => void;

  beforeEach(() => {
    localStorage.clear();
    useCharacterSettingsStore.setState({ byCharacter: {} });
    useSettingsStore.setState({ responseLength: "medium" });
    useChatStore.setState({ messages: EROTIC_HISTORY });
    entries = [];
    removeSink = addLogSink((entry) => entries.push(entry));
    vi.mocked(api.fetchReplySuggestions).mockReset();
  });

  afterEach(() => {
    removeSink();
    cleanup();
  });

  it("APIが失敗したら、その場面向けの代替候補を出す", async () => {
    vi.mocked(api.fetchReplySuggestions).mockRejectedValue(new api.SuggestionFetchError(503));
    renderComposer();

    fireEvent.click(suggestChip());

    const expected = getFallbackSuggestions("erotic");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: expected[0] })).toBeVisible();
    });
    expect(screen.getByRole("button", { name: expected[2] })).toBeVisible();
  });

  // 代替候補をそのまま並べると、AIが選んだ言いかたと見分けがつかん。
  // 失敗した事実を画面に残したうえで出す。
  it("代替候補には、出せんかったという断り書きが付く", async () => {
    vi.mocked(api.fetchReplySuggestions).mockRejectedValue(new api.SuggestionFetchError(503));
    renderComposer();

    fireEvent.click(suggestChip());

    await waitFor(() => {
      expect(screen.getByText("候補が出せんかった。")).toBeVisible();
    });
    expect(screen.getByRole("button", { name: "もう一度" })).toBeVisible();
    expect(screen.getByRole("button", { name: getFallbackSuggestions("erotic")[0] })).toBeVisible();
  });

  it("失敗を握り潰さず、理由をログに残す", async () => {
    vi.mocked(api.fetchReplySuggestions).mockRejectedValue(new api.SuggestionFetchError(503));
    renderComposer();

    fireEvent.click(suggestChip());

    await waitFor(() => {
      expect(entries.some((e) => e.level === "error" && e.ns === "composer")).toBe(true);
    });
  });

  // 通信が成功して0件だったのは「失敗」やない。ここで代替候補を出すと、
  // AIが本当に返した結果を作り話で覆い隠すことになる。
  it("成功して0件だった時は、代替候補を本物のふりで出さん", async () => {
    vi.mocked(api.fetchReplySuggestions).mockResolvedValue([]);
    renderComposer();

    fireEvent.click(suggestChip());

    await waitFor(() => {
      expect(screen.getByText("候補が出せんかった。")).toBeVisible();
    });
    for (const line of getFallbackSuggestions("erotic")) {
      expect(screen.queryByRole("button", { name: line })).toBeNull();
    }
    for (const line of getFallbackSuggestions("conversation")) {
      expect(screen.queryByRole("button", { name: line })).toBeNull();
    }
  });
});
