import type { TurnPhase } from "../lib/turn-phase";

// 部品 A: 発言の下の印の行（「まだ送れていません」「送り直しています」）。
// icon の有無は板の決めどおり（「まだ送れていません」だけ印つき）。
export const TurnMarker = ({ text, icon }: { text: string; icon: boolean }) => (
  <output className="v2-turn-marker">
    {icon && (
      <svg
        className="v2-turn-marker-icon"
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="8" cy="8" r="7" strokeWidth="1.75" />
        <line x1="8" y1="4.5" x2="8" y2="9" strokeWidth="1.75" strokeLinecap="round" />
        <circle cx="8" cy="11.5" r="0.9" fill="currentColor" stroke="none" />
      </svg>
    )}
    <span>{text}</span>
  </output>
);

// 部品 C: 発言の操作のボタン（発言の左の点 3 つ）。押すと「入力に戻す」と同じ動き。
export const TurnMessageAction = ({ onWithdraw }: { onWithdraw: () => void }) => (
  <button
    type="button"
    className="v2-turn-message-action"
    aria-label="この発言の操作（取り消す）"
    onClick={onWithdraw}
  >
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <circle cx="5.5" cy="11" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="11" cy="11" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="16.5" cy="11" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  </button>
);

export type FailureAction = {
  label: string;
  onClick: () => void;
  // 「もう一度」は回る矢印つきの強いボタン、「入力に戻す」は地なしの静かなボタン。
  retry?: boolean;
  disabled?: boolean;
};

// 失敗の枠の下に並べる出口ボタン。状態ごとの組み合わせは板 TalkError の表のとおり
//（送れなかった・途中で止まったは「もう一度」、書き直しが要る時は「入力に戻す」）。
export const failureActionsFor = (
  phase: TurnPhase,
  retry: () => void,
  withdraw: () => void,
): FailureAction[] => {
  if (phase === "send_failed") {
    return [
      { label: "もう一度", onClick: retry, retry: true },
      { label: "入力に戻す", onClick: withdraw },
    ];
  }
  if (phase === "no_reply" || phase === "cut_off" || phase === "offline") {
    return [{ label: "もう一度", onClick: retry, retry: true }];
  }
  if (phase === "rejected") return [{ label: "入力に戻す", onClick: withdraw }];
  return [];
};

// 部品 B: 失敗の枠。主の文・副の文・ボタンの行。
export const TurnFailureBox = ({
  primary,
  secondary,
  actions,
}: {
  primary: string;
  secondary?: string;
  actions: FailureAction[];
}) => (
  <div className="v2-turn-failure" role="alert">
    <div className="v2-turn-failure-head">
      <span className="v2-turn-failure-icon" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="8.5" strokeWidth="1.75" />
          <line x1="10" y1="6" x2="10" y2="11.5" strokeWidth="1.75" strokeLinecap="round" />
          <circle cx="10" cy="14.5" r="1.1" fill="currentColor" stroke="none" />
        </svg>
      </span>
      <div className="v2-turn-failure-text">
        <div className="v2-turn-failure-primary">{primary}</div>
        {secondary && <div className="v2-turn-failure-secondary">{secondary}</div>}
      </div>
    </div>
    <div className="v2-turn-failure-actions">
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          className={action.retry ? "v2-turn-retry" : "v2-turn-withdraw"}
          onClick={action.onClick}
          disabled={action.disabled}
        >
          {action.retry && (
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <path d="M15 9a6 6 0 1 1-1.76-4.24" strokeWidth="1.75" strokeLinecap="round" />
              <path
                d="M15 2.2v3h-3"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
          {action.label}
        </button>
      ))}
    </div>
  </div>
);

// 失敗の枠の中身を TurnPhase から組み立てる。文言は板 TalkError の文言のまま。
// 429（1 日の上限）の時だけ副の文をサーバの文へ差し替える。
export const failureCopy = (
  phase: TurnPhase,
  dailyLimitMessage?: string | null,
): { primary: string; secondary?: string } | null => {
  switch (phase) {
    case "send_failed":
      return { primary: "メッセージを送れませんでした。" };
    case "no_reply":
      return { primary: "返事が届きませんでした。" };
    case "cut_off":
      return { primary: "返事が途中で止まりました。" };
    case "rejected":
      return {
        primary: "メッセージを送れませんでした。",
        secondary:
          dailyLimitMessage ?? "このままでは送れません。\n入力に戻して、書き直してください。",
      };
    case "offline":
      return { primary: "オフラインです。", secondary: "つながったら、もう一度送れます。" };
    default:
      return null;
  }
};

// 部品 D: 「止める」ボタン。入力の行の右端で送信ボタンと入れ替わる。
export const TurnStopButton = ({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    className="v2-turn-stop"
    aria-label="返事を止める"
    onClick={onClick}
    disabled={disabled}
  >
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="5" y="5" width="10" height="10" rx="2" strokeWidth="2" />
    </svg>
    止める
  </button>
);

// TalkWaiting 6「止めたあと」の印の行。
export const StoppedMarker = () => <div className="v2-turn-stopped">ここで止めました</div>;
