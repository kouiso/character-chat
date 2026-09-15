import type { ScenePhase } from "./scene-phase";

// 22 ターン目から。モデルを速い側へ切り替える判断に使う（resolveChatRouting）。
export const LATE_TURN_START = 22;

// 書き出しの多様化はもっと早う要る。実測(2026-08-17 phase6 の 10 ターン通し):
// 霜月鈴の台詞 110 行のうち 38 行が完全に同一で、「まあ…いいけど」で始まる行が 11 回。
// 桜庭さくらも 77 行中 17 行が同一。雛形は 7 ターン目には固まっとった。
// 22 まで待つ仕掛けは、10 ターンの通しでは一度も動かん。
// モデル切替とは別の閾値にする。片方を下げるともう片方まで動く状態やった。
export const DIVERSITY_DIRECTIVE_START = 4;

const LATE_TURN_VIEWPOINTS = [
  "音と呼吸の変化",
  "手足の動きと姿勢",
  "温度・匂い・肌触り",
  "台詞と途切れる内心",
] as const;

const CONVERSATION_LATE_TURN_VIEWPOINTS = [
  "直前の話題との具体的なつながり",
  "新しい場所・物・時間帯",
  "選択肢とその理由",
  "次に試す小さな行動",
] as const;

export type LateTurnStrategy = {
  isLateTurn: boolean;
  diversityDirective: string | null;
};

export const resolveLateTurnStrategy = (
  userTurnCount: number,
  phase: ScenePhase,
): LateTurnStrategy => {
  const isLateTurn = userTurnCount >= LATE_TURN_START;
  if (userTurnCount < DIVERSITY_DIRECTIVE_START) {
    return { isLateTurn, diversityDirective: null };
  }

  const viewpoints =
    phase === "conversation" ? CONVERSATION_LATE_TURN_VIEWPOINTS : LATE_TURN_VIEWPOINTS;
  const viewpoint = viewpoints[(userTurnCount - DIVERSITY_DIRECTIVE_START) % viewpoints.length];
  // 台詞の書き出しを名指しで禁じる。実測では地の文より台詞が先に雛形化する。
  const lineOpeningRule =
    "直近 3 ターンで使った台詞の書き出しを使わない。同じ切り出しから別の内容へ繋ぐのは反復に数える。";
  if (phase === "conversation") {
    return {
      isLateTurn,
      diversityDirective:
        `【場面の変化】今回は「${viewpoint}」を主軸にする。直近の応答とは異なる書き出し・文末を選び、` +
        `既出内容の言い換えではなく、現在の話題から会話を一段先へ進める。${lineOpeningRule}この指示には言及しない。`,
    };
  }

  return {
    isLateTurn,
    diversityDirective:
      `【場面の変化】今回は「${viewpoint}」を主軸にする。直近の応答とは異なる書き出し・文末・身体反応を選び、` +
      `既出場面の言い換えではなく現在の動作から一段先へ進める。${lineOpeningRule}この指示には言及しない。`,
  };
};
