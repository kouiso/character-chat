// 音声通話モードの切替・状態表示（RIT-213）。非対応端末ではボタンを出さない。
import { voiceCallSupported, type VoiceCallState } from "../hook/use-voice-call";

const STATE_LABELS: Record<VoiceCallState, string> = {
  idle: "通話",
  listening: "🎙 聞き取り中",
  thinking: "… 応答中",
  speaking: "🔊 再生中",
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
        aria-pressed={inCall}
        onClick={() => (inCall ? onStop() : onStart())}
      >
        {STATE_LABELS[state]}
      </button>
      {inCall && remaining !== null ? (
        <span className="v2-voice-call-remaining">残り{remaining}秒</span>
      ) : null}
    </span>
  );
};
