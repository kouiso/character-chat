import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "@/lib/api";

import { OuseComposer } from "./ouse-composer";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  fetchReplySuggestions: vi.fn(),
}));

// 会話行は最初の送信で初めて出来る。会話行を条件にすると、いちばん要る 1 手目
// （何て言えばええか分からん瞬間）で候補が必ず黙る。
const renderComposer = (isLoading: boolean) =>
  render(
    <OuseComposer
      onSend={vi.fn()}
      onSendDirective={vi.fn()}
      onImageGenerate={vi.fn()}
      isLoading={isLoading}
      characterName="燈子"
      characterId="char-1"
      conversationId={null}
    />,
  );

describe("OuseComposer の返信候補", () => {
  beforeEach(() => {
    vi.mocked(api.fetchReplySuggestions).mockResolvedValue(["候補1", "候補2", "候補3"]);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(api.fetchReplySuggestions).mockReset();
    cleanup();
  });

  it("会話行がまだ無くても取りにいく", () => {
    const { rerender } = renderComposer(true);

    rerender(
      <OuseComposer
        onSend={vi.fn()}
        onSendDirective={vi.fn()}
        onImageGenerate={vi.fn()}
        isLoading={false}
        characterName="燈子"
        characterId="char-1"
        conversationId={null}
      />,
    );
    act(() => {
      vi.runAllTimers();
    });

    expect(api.fetchReplySuggestions).toHaveBeenCalledWith({
      characterId: "char-1",
      conversationId: undefined,
    });
  });
});
