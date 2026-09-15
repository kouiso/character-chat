import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatscopeInputBar } from "./chatscope-input-bar";
import { CONTENT_EDITOR_SELECTOR } from "./composer-draft";

const DRAFT = "長い下書き。送る前に取っておきたい";

const bar = (isLoading: boolean, onSend: (message: string) => void) => (
  <ChatscopeInputBar
    onSend={onSend}
    onImageGenerate={vi.fn()}
    onBegSheetOpen={vi.fn()}
    isLoading={isLoading}
    characterName="燈子"
  />
);

const renderBar = (isLoading: boolean, onSend = vi.fn()) => {
  render(bar(isLoading, onSend));
  return onSend;
};

// chatscope の MessageInput は contenteditable な div。値の更新は input イベントで走る。
const typeDraft = (text: string): HTMLElement => {
  const editor = screen.getByRole("textbox", { name: /メッセージ入力/ });
  editor.innerHTML = text;
  fireEvent.input(editor);
  return editor;
};

const editorNode = (): HTMLElement => {
  const editor = document.querySelector<HTMLElement>(CONTENT_EDITOR_SELECTOR);
  if (!editor) throw new Error("入力欄が見つからん");
  return editor;
};

afterEach(cleanup);

describe("ChatscopeInputBar の待ち中の入力", () => {
  // 長文を送って返事を待つ 25〜45 秒のあいだ、入力欄が一文字も受け付けんかった
  // （局長 2026-08-17, Android 実機）。chatscope の ContentEditable は disabled を
  // 渡すと contentEditable={false} を描くので、入力欄が本当に死ぬ。
  it("返事を待っている間も入力欄は編集できる", () => {
    renderBar(true);

    expect(editorNode().getAttribute("contenteditable")).toBe("true");

    typeDraft(DRAFT);

    expect(editorNode().textContent).toBe(DRAFT);
  });

  // 待ち中は送信だけを止める。ターンの機構（streamCounterRef・永続化・オフラインキュー）が
  // 同時に 1 ターンだけを前提にしとるので、キューにも差し替えにもせん。
  it("返事を待っている間は送信ボタンを押させない", () => {
    renderBar(true);
    typeDraft(DRAFT);

    expect(screen.getByRole("button", { name: "送信" })).toBeDisabled();
  });

  // chatscope の send() は sendDisabled を見ず、onSend の前に入力欄を空にする。
  // 待ち中に Enter を押されたら本文だけが消えて何も送られん、が一番損。
  it("返事を待っている間の Enter で下書きを失わない", () => {
    const onSend = renderBar(true);
    const editor = typeDraft(DRAFT);

    fireEvent.keyPress(editor, { key: "Enter", code: "Enter", charCode: 13 });

    expect(onSend).not.toHaveBeenCalled();
    expect(editorNode().textContent).toBe(DRAFT);
  });

  it("返事が返ってきたら送信できる", () => {
    const onSend = renderBar(false);
    typeDraft(DRAFT);

    const send = screen.getByRole("button", { name: "送信" });
    expect(send).not.toBeDisabled();
    fireEvent.click(send);

    expect(onSend).toHaveBeenCalledWith(DRAFT);
  });
});

describe("ChatscopeInputBar の下書きコピー", () => {
  const writeText = vi.fn(async () => undefined);

  beforeEach(() => {
    writeText.mockClear();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  });

  // 送る前に長文を取っておきたかったのに、入力欄からコピーでけへんかった
  // （局長 2026-08-17, Android 実機）。長押し選択は chatscope の ContentEditable が
  // 更新のたびに replaceCaret で選択を畳んでまうため当てにでけん。下書き丸ごとを
  // 一手で取れる口を置く。
  it("下書きをコピーできる", async () => {
    renderBar(false);
    typeDraft(DRAFT);

    fireEvent.click(screen.getByRole("button", { name: "下書きをコピー" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(DRAFT));
  });

  it("下書きが無いときはコピーの口を出さない", () => {
    renderBar(false);

    expect(screen.queryByRole("button", { name: "下書きをコピー" })).not.toBeInTheDocument();
  });

  // 選択が消える仕組みの計測（jsdom, 2026-08-17）: MessageInput へ disabled を渡すと
  // ContentEditable.shouldComponentUpdate が通り、componentDidUpdate の replaceCaret が
  // removeAllRanges してキャレットを末尾へ寄せる。実測で「長い下書き」の全選択が
  // isLoading の立ち上がりで空になった。長押し選択→コピーが実機で取り逃がされる筋。
  it("isLoading が立っても入力欄の選択が消えない", () => {
    const onSend = vi.fn();
    const { rerender } = render(bar(false, onSend));
    typeDraft(DRAFT);

    const editor = editorNode();
    editor.focus();
    const selection = window.getSelection();
    if (!selection) throw new Error("選択が取れん");
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection.removeAllRanges();
    selection.addRange(range);
    expect(selection.toString()).toBe(DRAFT);

    rerender(bar(true, onSend));

    expect(window.getSelection()?.toString()).toBe(DRAFT);
  });
});
