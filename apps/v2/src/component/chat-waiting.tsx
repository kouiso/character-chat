import { useEffect, useState } from "react";

import type { CreationNoticePhase } from "../lib/turn-phase";

// 待ちの知らせ（板 TalkWaiting 1・2・3）。相手の吹き出しの形をした点 3 つの泡を
// 発言の並びの中に出す。長引く時だけ泡の右に副の文を足す。
export const ChatWaiting = ({ phase }: { phase: CreationNoticePhase }) => {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div
      className="v2-turn-row assistant v2-turn-waiting"
      role="status"
      aria-label="返事を書いています"
    >
      <span className="v2-turn-typing" aria-hidden="true">
        <span className="v2-typing-dot" />
        <span className="v2-typing-dot" />
        <span className="v2-typing-dot" />
      </span>
      <span className="v2-turn-waiting-main">作成中</span>
      <span className="v2-turn-waiting-elapsed">{elapsedSeconds}秒</span>
      {phase === "slow" && <span className="v2-turn-waiting-sub">少し時間がかかっています</span>}
    </div>
  );
};
