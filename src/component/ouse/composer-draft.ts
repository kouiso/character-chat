// chatscope の MessageInput 内の contenteditable。
export const CONTENT_EDITOR_SELECTOR = ".cs-message-input__content-editor";

const moveCaretToEnd = (editor: HTMLElement): void => {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
};

// 候補を入力欄へ入れる（送らん）。
//
// chatscope の MessageInput は contenteditable を自分で抱える非制御コンポーネントで、
// 外から文字を入れる props が無い。value を渡して制御モードへ切り替えると、送信後の
// クリアと送信ボタンの活性まで呼び出し側の責任になり、今のチャット入力の挙動が変わる。
// このディレクトリは既に「じぶんのことばで」で同じセレクタを掴んで focus しとるので、
// 同じ経路で書く。textContent へ入れるので、候補にタグ文字が混じっても HTML にならん。
export const insertComposerDraft = (root: ParentNode, text: string): boolean => {
  const editor = root.querySelector<HTMLElement>(CONTENT_EDITOR_SELECTOR);
  if (!editor) return false;

  editor.textContent = text;
  // input を発火させんと chatscope 内部の state が空のまま残る。送信ボタンは
  // disabled、send() も stateValue.length === 0 で弾かれ、入れた候補が送れん。
  editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
  editor.focus();
  moveCaretToEnd(editor);
  return true;
};

// 入力欄の書きかけを読む。候補を自動で出すかの判定に使う——既に打っとる人へ
// 候補を被せると、書いた文が消えるか、要らん生成に金がかかるかのどちらかになる。
export const readComposerDraft = (root: ParentNode): string =>
  root.querySelector<HTMLElement>(CONTENT_EDITOR_SELECTOR)?.textContent?.trim() ?? "";
