import type { TurnPhase } from "../lib/turn-phase";

// 待ちの知らせ（板 TalkWaiting 1・2・3）。相手の吹き出しの形をした点 3 つの泡を
// 発言の並びの中に出す。長引く時だけ泡の右に副の文を足す。
export const ChatWaiting = ({ phase }: { phase: TurnPhase }) => (
  <div
    className="v2-turn-row assistant v2-turn-waiting"
    role="status"
    aria-label={phase === "arriving" ? "返事が届いています" : "返事を書いています"}
  >
    <span className="v2-turn-typing" aria-hidden="true">
      <span className="v2-typing-dot" />
      <span className="v2-typing-dot" />
      <span className="v2-typing-dot" />
    </span>
    {phase === "slow" && <span className="v2-turn-waiting-sub">少し時間がかかっています</span>}
  </div>
);
