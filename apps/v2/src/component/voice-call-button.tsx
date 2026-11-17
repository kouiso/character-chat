// 音声通話モードの切替・状態表示（RIT-213）。非対応端末ではボタンを出さない。
import { voiceCallSupported, type VoiceCallState } from "../hook/use-voice-call";
import { TalkIcon } from "./talk-icon";

const STATE_LABELS: Record<VoiceCallState, string> = {
  idle: "電話する",
  listening: "聞いています",
  thinking: "返事を待っています",
  speaking: "声で聞いています",
  blocked: "無料枠終了",
};

export const VoiceCallButton = ({
  state,
  remaining,
  onStart,
  onStop,
}: {
  state: VoiceCallState;
  remaining: number | null;
  onStart: () => void;
  onStop: () => void;
}) => {
  if (!voiceCallSupported()) return null;
  const inCall = state !== "idle" && state !== "blocked";
  return (
    <span className="v2-voice-call">
      <button
        type="button"
        className="v2-voice-call-toggle"
        aria-label={inCall ? "通話を終える" : STATE_LABELS[state]}
        title={STATE_LABELS[state]}
        aria-pressed={inCall}
        onClick={() => (inCall ? onStop() : onStart())}
      >
        <TalkIcon name="phone" />
      </button>
      {inCall && remaining !== null ? (
        <span className="v2-voice-call-remaining">残り{remaining}秒</span>
      ) : null}
    </span>
  );
};
