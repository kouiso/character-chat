import { afterEach, describe, expect, it, vi } from "vitest";

import { CONTENT_EDITOR_SELECTOR, insertComposerDraft } from "./composer-draft";

const mountEditor = (): HTMLElement => {
  const host = document.createElement("div");
  host.innerHTML = `<div class="${CONTENT_EDITOR_SELECTOR.slice(1)}" contenteditable="true"></div>`;
  document.body.appendChild(host);
  return host.querySelector<HTMLElement>(CONTENT_EDITOR_SELECTOR)!;
};

describe("候補を入力欄へ入れる", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("入力欄の中身を候補で置き換える", () => {
    const editor = mountEditor();

    expect(insertComposerDraft(document, "（優しく微笑み）可愛いなぁ")).toBe(true);
    expect(editor.textContent).toBe("（優しく微笑み）可愛いなぁ");
  });

  // input を発火させんと chatscope 内部の state が空のままで、入れた候補が送れん
  // （送信ボタンが disabled、send() も stateValue.length === 0 で弾かれる）。
  it("input イベントを発火して chatscope 側へ変更を知らせる", () => {
    const editor = mountEditor();
    const onInput = vi.fn();
    editor.addEventListener("input", onInput);

    insertComposerDraft(document, "（少し困った顔）どうしよう");

    expect(onInput).toHaveBeenCalledTimes(1);
    expect(onInput.mock.calls[0][0].bubbles).toBe(true);
  });

  // タグ文字が候補に混じっても HTML として解釈されんこと（textContent 経由の担保）。
  it("候補の記号をマークアップにせん", () => {
    const editor = mountEditor();

    insertComposerDraft(document, "（笑う）<b>これ</b>はどう？");

    expect(editor.querySelector("b")).toBeNull();
    expect(editor.textContent).toBe("（笑う）<b>これ</b>はどう？");
  });

  it("入力欄が見つからんときは何もせず false を返す", () => {
    expect(insertComposerDraft(document, "（見つめる）ねえ")).toBe(false);
  });
});
