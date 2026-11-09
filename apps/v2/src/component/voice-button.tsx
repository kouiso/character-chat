// 応答の読み上げボタン（RIT-211）。再生中は停止ボタンに化ける。
export const VoiceButton = ({
  playing,
  busy,
  onPlay,
  onStop,
}: {
  playing: boolean;
  busy: boolean;
  onPlay: () => void;
  onStop: () => void;
}) => (
  <button
    type="button"
    className="v2-voice-button"
    disabled={busy}
    onClick={() => (playing ? onStop() : onPlay())}
    aria-label={playing ? "音声を停止" : "音声で再生"}
  >
    {playing ? "⏹ 停止" : "🔊"}
  </button>
);
