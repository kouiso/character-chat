// RIT-65 の送信状態（板 TalkWaiting / TalkError の各状態に対応）。
// どの状態にも、板で決めた出口（もう一度・入力に戻す・止める・戻る・送信）が最低 1 つ在る。
export type TurnPhase =
  // 入力に戻したあともここへ戻る（出口: 送信・戻る）
  | "idle"
  // 送っている時（止める・戻る）
  | "sending"
  // 返事を書いている時（止める・戻る）
  | "writing"
  // 時間がかかっている時（止める・戻る）
  | "slow"
  // 文が届きはじめた時（止める・戻る）
  | "arriving"
  // 送れなかった時（もう一度・入力に戻す・戻る）
  | "send_failed"
  // 送り直している時（部品C=入力に戻す・戻る）
  | "resending"
  // 返事が届かなかった時（もう一度・戻る）
  | "no_reply"
  // 返事が途中で止まった時（もう一度・戻る）
  | "cut_off"
  // もう一度送れない時（入力に戻す・戻る）
  | "rejected"
  // オフラインの時（もう一度・戻る）
  | "offline"
  // 止めたあと（送信・戻る）
  | "stopped";

// 「止める」ボタンを出す待ち状態。板 TalkWaiting-5「「止める」を押せる時」。
export const isWaitingPhase = (phase: TurnPhase): boolean =>
  phase === "sending" || phase === "writing" || phase === "slow" || phase === "arriving";

export type CreationNoticePhase = "sending" | "writing" | "slow";

// 「作成中」の印を出すのは返事がまだ届き始めていない間だけ。arriving では
// 返事そのものが見え始めているため、待ちの印を重ねない。
export const isCreationNoticePhase = (phase: TurnPhase): phase is CreationNoticePhase =>
  phase === "sending" || phase === "writing" || phase === "slow";

// 失敗の枠（部品 B）を出す状態。
export const isFailurePhase = (phase: TurnPhase): boolean =>
  phase === "send_failed" ||
  phase === "resending" ||
  phase === "no_reply" ||
  phase === "cut_off" ||
  phase === "rejected" ||
  phase === "offline";

// 発言の左に操作ボタン（部品 C=入力に戻す）を出す状態。
export const hasMessageAction = (phase: TurnPhase): boolean =>
  phase === "send_failed" || phase === "resending" || phase === "rejected";

// 発言の下に出す印の文（部品 A）。resending だけ文が違う。
export const markerText = (phase: TurnPhase): string | null =>
  phase === "send_failed" || phase === "rejected"
    ? "まだ送れていません"
    : phase === "resending"
      ? "送り直しています"
      : null;
