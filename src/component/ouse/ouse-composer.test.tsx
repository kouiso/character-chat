import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "@/lib/api";
import { useCharacterSettingsStore } from "@/store/character-settings-store";
import { useSettingsStore } from "@/store/settings-store";

import { CONTENT_EDITOR_SELECTOR } from "./composer-draft";
import { OuseComposer } from "./ouse-composer";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  fetchReplySuggestions: vi.fn(),
}));

const CHARACTER_ID = "char-1";

const renderComposer = (characterId: string | null) =>
  render(
    <OuseComposer
      onSend={vi.fn()}
      onSendDirective={vi.fn()}
      onImageGenerate={vi.fn()}
      isLoading={false}
      characterName="燈子"
      characterId={characterId}
    />,
  );

// 「ことば」チップは長さを順番に切り替える。押した後に何がどこへ保存されたかを見る。
const cycleLength = () => {
  fireEvent.click(screen.getByText(/^ことば/));
};

describe("OuseComposer の長さチップ", () => {
  beforeEach(() => {
    localStorage.clear();
    useCharacterSettingsStore.setState({ byCharacter: {} });
    useSettingsStore.setState({ responseLength: "short" });
  });

  afterEach(cleanup);

  // シートは「この子だけに効きます」と謳っとるので、チップもこの子へ書かんと
  // シートで長さを決めた子でチップが無反応になる。
  it("この子との設定へ書く", () => {
    renderComposer(CHARACTER_ID);

    cycleLength();

    expect(useCharacterSettingsStore.getState().byCharacter[CHARACTER_ID]?.responseLength).toBe(
      "medium",
    );
  });

  // 設定画面のグローバルな「ことばの量」は devMode の中にあって普段は出てこん。
  // このチップが唯一の全体制御なので、この子だけに書くと、まだ設定してへん子の
  // 既定を変える手段が無くなる。
  it("全体の既定値も一緒に動かす", () => {
    renderComposer(CHARACTER_ID);

    cycleLength();

    expect(useSettingsStore.getState().responseLength).toBe("medium");
  });

  it("キャラ未選択なら全体設定だけを動かす", () => {
    renderComposer(null);

    cycleLength();

    expect(useSettingsStore.getState().responseLength).toBe("medium");
    expect(useCharacterSettingsStore.getState().byCharacter).toEqual({});
  });

  // この子に設定済みなら、表示もその子の値でなければ「今どれが効いとるか」が嘘になる。
  it("この子に設定があればその値を表示する", () => {
    useSettingsStore.setState({ responseLength: "short" });
    useCharacterSettingsStore.setState({
      byCharacter: { [CHARACTER_ID]: { responseLength: "very_long" } },
    });

    renderComposer(CHARACTER_ID);

    expect(screen.getByText(/^ことば/).textContent).toContain("たっぷり");
  });
});

// 局長報告 2026-08-18:「次の返信が予測して楽に出るようにして欲しい」。
// 候補はチップを押した時だけ出しとったので、毎ターン「次に何を言うか」を
// 自分で考えてから押す、という手数が要っとった。
describe("返事が届いたら候補を自動で出す", () => {
  beforeEach(() => {
    localStorage.clear();
    useCharacterSettingsStore.setState({ byCharacter: {} });
    vi.mocked(api.fetchReplySuggestions).mockResolvedValue([
      "（微笑み）そばにおって",
      "もう少しだけ",
    ]);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(api.fetchReplySuggestions).mockReset();
    cleanup();
  });

  const renderWith = (isLoading: boolean) =>
    render(
      <OuseComposer
        onSend={vi.fn()}
        onSendDirective={vi.fn()}
        onImageGenerate={vi.fn()}
        isLoading={isLoading}
        characterName="燈子"
        characterId={CHARACTER_ID}
        conversationId="conv-1"
      />,
    );

  it("返事の生成が終わった直後に取りにいく", () => {
    const { rerender } = renderWith(true);

    rerender(
      <OuseComposer
        onSend={vi.fn()}
        onSendDirective={vi.fn()}
        onImageGenerate={vi.fn()}
        isLoading={false}
        characterName="燈子"
        characterId={CHARACTER_ID}
        conversationId="conv-1"
      />,
    );
    act(() => {
      vi.runAllTimers();
    });

    expect(api.fetchReplySuggestions).toHaveBeenCalledTimes(1);
  });

  // 書きかけを候補で潰さん。要らん生成に金もかからん。
  it("入力欄に書きかけがあれば取りにいかん", () => {
    const { rerender } = renderWith(true);

    rerender(
      <OuseComposer
        onSend={vi.fn()}
        onSendDirective={vi.fn()}
        onImageGenerate={vi.fn()}
        isLoading={false}
        characterName="燈子"
        characterId={CHARACTER_ID}
        conversationId="conv-1"
      />,
    );
    // 判定はタイマーが鳴った時点でやる。返事を待っとる間に打ち始める人がおるので、
    // 生成が終わった瞬間やのうて、実際に投げる直前の入力欄を見るのが正しい。
    const editor = document.querySelector<HTMLElement>(CONTENT_EDITOR_SELECTOR);
    expect(editor, "入力欄が描かれてへんと、この保護は何も検査でけん").not.toBeNull();
    if (editor) editor.textContent = "もう少しだけ一緒に";
    act(() => {
      vi.runAllTimers();
    });

    expect(api.fetchReplySuggestions).not.toHaveBeenCalled();
  });

  // 会話がまだ無い＝1 通目。「何て言えばええか分からん」瞬間そのものなので、
  // ここで黙ると候補がいちばん要る場面で必ず出ん（#1491）。サーバも会話 id 無しを受ける。
  it("会話がまだ無くても取りにいく", () => {
    const props = {
      onSend: vi.fn(),
      onSendDirective: vi.fn(),
      onImageGenerate: vi.fn(),
      characterName: "燈子",
      characterId: CHARACTER_ID,
    };
    const { rerender } = render(<OuseComposer {...props} isLoading />);

    rerender(<OuseComposer {...props} isLoading={false} />);
    act(() => {
      vi.runAllTimers();
    });

    expect(api.fetchReplySuggestions).toHaveBeenCalled();
  });
});
