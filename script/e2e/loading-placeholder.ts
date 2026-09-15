// Ouse は「返事を待っとる」状態を本文と同じ場所へ文字として描画する
// (`src/component/ouse/her-message.tsx:300`, `src/component/chat/message-bubble.tsx:217`)。
// DOM から本文を読む処理はこれを本文と区別できず、待ち文言をアシスタントの発言として
// 記録してまう。#899 の採点はそれを「ただの会話」と判定して点を落としとった。
//
// 判定を1箇所に置くのは、2026-07-11 の修正が browser-wait 側だけを直して
// scenario-runner 側を見逃し、同じバグが4か月ぶん残ったため。読む場所が増えても
// 判定は増やさん。
export const LOADING_PLACEHOLDER_PATTERN = /^(ことばを探している|受信中)[….]*$/;

export const isLoadingPlaceholder = (text: string): boolean =>
  LOADING_PLACEHOLDER_PATTERN.test(text.trim());

/** 待ち文言なら空文字にする。呼び出し側の「本文が空」の分岐へ流すため。 */
export const stripLoadingPlaceholder = (text: string): string =>
  isLoadingPlaceholder(text) ? "" : text;
