import { TalkIcon } from "./talk-icon";
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
    aria-label={playing ? "声を止める" : "この返事を声で聞く"}
  >
    <TalkIcon name={playing ? "stop" : "speaker"} />
  </button>
);
