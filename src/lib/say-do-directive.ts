// say/do の入力マーカー記法。composer が組み立て、prompt-builder.ts の
// [USER INPUT MARKERS] ブロックが解釈する。片方だけ変えるとモデルに生タグが
// そのまま届いて画面にも漏れるので、必ず両方を揃える（#824）。
export type SayDoMode = "say" | "do";

export const buildSayDoDirective = (mode: SayDoMode, text: string): string =>
  `[${mode.toUpperCase()}: "${text}"]`;
