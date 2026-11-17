import type { TurnPhase } from "../lib/turn-phase";

// 待ちの知らせ（板 TalkWaiting の状態 1・2・3 の [div:返事を書いています] の行）。
// 「返事の候補を用意しています」は RIT-203 の候補欄が持つのでここでは出さん。
export const ChatWaiting = ({ phase }: { phase: TurnPhase }) => {
  const sub = phase === "slow" ? "少し時間がかかっています" : null;
  const main = phase === "arriving" ? "返事が届いています" : "返事を書いています";
  return (
    <output className="v2-turn-waiting">
      <span className="v2-turn-waiting-main">{main}</span>
      {sub && <span className="v2-turn-waiting-sub">{sub}</span>}
    </output>
  );
};
