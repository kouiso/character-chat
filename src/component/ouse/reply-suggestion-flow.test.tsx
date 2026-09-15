import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "@/lib/api";
import { useCharacterSettingsStore } from "@/store/character-settings-store";
import { useSettingsStore } from "@/store/settings-store";

import { CONTENT_EDITOR_SELECTOR } from "./composer-draft";
import { OuseComposer } from "./ouse-composer";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof api>();
  return { ...actual, fetchReplySuggestions: vi.fn() };
});

const SUGGESTIONS = [
  "（優しく微笑み）可愛いなぁ、本当に俺のものだよ。",
  "（少し困った顔）どうしよう、止められないくらい気持ち良すぎて。",
  "（耳元に口を寄せ）今どこが一番いいか、言ってみて。",
];

const CHARACTER_ID = "char-1";
const CONVERSATION_ID = "conv-1";

const renderComposer = (
  overrides: { conversationId?: string | null; onSend?: () => void } = {},
) => {
  const onSend = overrides.onSend ?? vi.fn();
  render(
    <OuseComposer
      onSend={onSend}
      onSendDirective={vi.fn()}
      onImageGenerate={vi.fn()}
      isLoading={false}
      characterName="霜月鈴"
      characterId={CHARACTER_ID}
      conversationId={
        overrides.conversationId === undefined ? CONVERSATION_ID : overrides.conversationId
      }
    />,
  );
  return { onSend };
};

const suggestChip = () => screen.getByRole("button", { name: "なんて言う？" });
const editor = () => document.querySelector<HTMLElement>(CONTENT_EDITOR_SELECTOR);

describe("返信候補の導線", () => {
  beforeEach(() => {
    localStorage.clear();
    useCharacterSettingsStore.setState({ byCharacter: {} });
    useSettingsStore.setState({ responseLength: "medium" });
    vi.mocked(api.fetchReplySuggestions).mockReset();
    vi.mocked(api.fetchReplySuggestions).mockResolvedValue(SUGGESTIONS);
  });

  afterEach(cleanup);

  // 入口は既存のチップ列。別の場所へ置くと、チップを触る手の流れから外れる。
  it("チップ列の中に入口がある", () => {
    renderComposer();

    expect(suggestChip()).toBeVisible();
    expect(suggestChip()).toHaveAttribute("aria-pressed", "false");
  });

  it("押すと候補を取りに行き、待っとる間もそれが分かる", async () => {
    vi.mocked(api.fetchReplySuggestions).mockReturnValue(new Promise(() => {}));
    renderComposer();

    fireEvent.click(suggestChip());

    expect(screen.getByText("言いかたを探しとる…")).toBeVisible();
    expect(vi.mocked(api.fetchReplySuggestions)).toHaveBeenCalledWith({
      conversationId: CONVERSATION_ID,
      characterId: CHARACTER_ID,
    });
    await waitFor(() => expect(suggestChip()).toHaveAttribute("aria-pressed", "true"));
  });

  it("候補が並ぶ", async () => {
    renderComposer();

    fireEvent.click(suggestChip());

    await waitFor(() => {
      expect(screen.getByRole("button", { name: SUGGESTIONS[0] })).toBeVisible();
    });
    expect(screen.getByRole("button", { name: SUGGESTIONS[2] })).toBeVisible();
  });

  // 局長の要件そのもの。押した瞬間に送ってしまうと、直す機会が無い。
  it("候補を押すと入力欄へ入り、送信はされん", async () => {
    const { onSend } = renderComposer();

    fireEvent.click(suggestChip());
    await waitFor(() => screen.getByRole("button", { name: SUGGESTIONS[1] }));
    fireEvent.click(screen.getByRole("button", { name: SUGGESTIONS[1] }));

    expect(editor()?.textContent).toBe(SUGGESTIONS[1]);
    expect(onSend).not.toHaveBeenCalled();
  });

  // 入力欄へ文字を置くだけやと chatscope 内部の state は空のままで、送信ボタンが
  // disabled で残る（そのまま送れん候補になる）。入れた直後に送れる状態かを見る。
  it("入れた候補はそのまま送れる状態になる", async () => {
    renderComposer();

    fireEvent.click(suggestChip());
    await waitFor(() => screen.getByRole("button", { name: SUGGESTIONS[0] }));
    fireEvent.click(screen.getByRole("button", { name: SUGGESTIONS[0] }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "送信" })).toBeEnabled();
    });
  });

  it("候補を選んだらパネルは閉じる", async () => {
    renderComposer();

    fireEvent.click(suggestChip());
    await waitFor(() => screen.getByRole("button", { name: SUGGESTIONS[0] }));
    fireEvent.click(screen.getByRole("button", { name: SUGGESTIONS[0] }));

    expect(screen.queryByRole("button", { name: SUGGESTIONS[0] })).toBeNull();
    expect(suggestChip()).toHaveAttribute("aria-pressed", "false");
  });

  it("出し直すと別の組を取りに行く", async () => {
    renderComposer();

    fireEvent.click(suggestChip());
    await waitFor(() => screen.getByRole("button", { name: SUGGESTIONS[0] }));

    const secondSet = ["（黙って抱き寄せる）今日はもう帰さんよ。"];
    vi.mocked(api.fetchReplySuggestions).mockResolvedValue(secondSet);
    fireEvent.click(screen.getByRole("button", { name: "出し直す" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: secondSet[0] })).toBeVisible();
    });
    expect(screen.queryByRole("button", { name: SUGGESTIONS[0] })).toBeNull();
    expect(vi.mocked(api.fetchReplySuggestions)).toHaveBeenCalledTimes(2);
  });

  it("もう一度押すとパネルを閉じ、余計に取りに行かん", async () => {
    renderComposer();

    fireEvent.click(suggestChip());
    await waitFor(() => screen.getByRole("button", { name: SUGGESTIONS[0] }));
    fireEvent.click(suggestChip());

    expect(screen.queryByRole("button", { name: SUGGESTIONS[0] })).toBeNull();
    expect(vi.mocked(api.fetchReplySuggestions)).toHaveBeenCalledTimes(1);
  });

  it("失敗したら候補は出さず、もう一度の口を出す", async () => {
    vi.mocked(api.fetchReplySuggestions).mockRejectedValue(new api.SuggestionFetchError(503));
    renderComposer();

    fireEvent.click(suggestChip());

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "もう一度" })).toBeVisible();
    });
    expect(screen.getByText("候補が出せんかった。")).toBeVisible();
  });

  // 1 通目こそ「何て言えばええか分からん」瞬間なので、会話行が無くても押させる（#1491）。
  it("会話が始まる前でも押せる", () => {
    renderComposer({ conversationId: null });

    expect(suggestChip()).toBeEnabled();
  });
});
