/**
 * 送信の最中にアプリが背面へ回ったかを見張る。
 *
 * ブラウザは背面のタブ・別アプリへ移った PWA の通信を止める。止められた送信は
 * 「サーバが断った失敗」やのうて「こちらの都合で切れた中断」なので、扱いを分ける。
 * 局長 2026-08-19「他のアプリに移動すると失敗します」の実体がこれ。
 *
 * 前面で落ちた失敗（サーバエラー等）は今までどおり手動タップ再送に委ねる。自動再送は
 * 前面でしか走らんので、再送がまた落ちても背面判定は立たず、無限ループにならん。
 */
export interface BackgroundWatch {
  /** 見張り始めてから今までに一度でも背面へ回ったか */
  wasBackgrounded: () => boolean;
  stop: () => void;
}

const NOOP_WATCH: BackgroundWatch = {
  wasBackgrounded: () => false,
  stop: () => {},
};

export const watchBackgrounded = (): BackgroundWatch => {
  if (typeof document === "undefined") return NOOP_WATCH;

  // 送信を始めた時点で既に背面なら、その送信は最初から止められうる。
  let backgrounded = document.visibilityState === "hidden";
  const onChange = () => {
    if (document.visibilityState === "hidden") backgrounded = true;
  };
  document.addEventListener("visibilitychange", onChange);

  return {
    wasBackgrounded: () => backgrounded,
    stop: () => document.removeEventListener("visibilitychange", onChange),
  };
};
