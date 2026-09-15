import { REPO_ROOT } from "./env.ts";
import { appendJsonl, readJsonl } from "./store.ts";

// P5: 👍の口。評価は「会話の終わりに1回 ＋ 良かった発話に任意👍」だけ。
// ここに貯まるのが唯一の正解データや。機械7軸では代われへん。

export const FEEDBACK_LOG = `${REPO_ROOT}apps/bench/.data/feedback.jsonl`;

/** 会話の終わりに1回。抜けたかどうかは局長しか判定できん */
export type EndOfRunFeedback = {
  kind: "end-of-run";
  ts: string;
  runId: string;
  /** 抜けたか。true / false だけ。点数は付けさせん */
  came: boolean;
  /** 続ける気になったか。2ターンで死ぬ問題の直接の観測 */
  wouldContinue: boolean;
  note?: string;
};

/** 良かった発話への任意👍。おまけ扱いで、押されんでも end-of-run だけで成立する */
export type UtteranceFeedback = {
  kind: "utterance";
  ts: string;
  runId: string;
  turnIndex: number;
  vote: "up" | "down";
  note?: string;
};

export type Feedback = EndOfRunFeedback | UtteranceFeedback;

export function recordEndOfRun(
  input: Omit<EndOfRunFeedback, "kind" | "ts">,
  path = FEEDBACK_LOG,
): EndOfRunFeedback {
  const record: EndOfRunFeedback = {
    kind: "end-of-run",
    ts: new Date().toISOString(),
    ...input,
  };
  appendJsonl(path, record);
  return record;
}

export function recordUtterance(
  input: Omit<UtteranceFeedback, "kind" | "ts">,
  path = FEEDBACK_LOG,
): UtteranceFeedback {
  const record: UtteranceFeedback = {
    kind: "utterance",
    ts: new Date().toISOString(),
    ...input,
  };
  appendJsonl(path, record);
  return record;
}

export type FeedbackSummary = {
  runs: number;
  came: number;
  wouldContinue: number;
  thumbsUp: number;
  thumbsDown: number;
};

export function summarizeFeedback(path = FEEDBACK_LOG): FeedbackSummary {
  const rows = readJsonl<Feedback>(path);
  const ends = rows.filter((r): r is EndOfRunFeedback => r.kind === "end-of-run");
  const votes = rows.filter((r): r is UtteranceFeedback => r.kind === "utterance");
  return {
    runs: ends.length,
    came: ends.filter((r) => r.came).length,
    wouldContinue: ends.filter((r) => r.wouldContinue).length,
    thumbsUp: votes.filter((v) => v.vote === "up").length,
    thumbsDown: votes.filter((v) => v.vote === "down").length,
  };
}
