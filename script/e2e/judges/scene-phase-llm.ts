import fs from "node:fs";
import path from "node:path";

import { classifySubtextEscalation } from "../../../functions/api/lib/subtext-escalation-classifier";
import { detectScenePhase, type ScenePhase } from "../../../src/lib/scene-phase";

import { type PhaseJudgment } from "./scene-phase";

import type { Phase } from "../types";

// keyword-only 判定は観測した言い回ししか拾えず、モデルの生成文の言い回しが変わる
// たびに一致率が変動する(2026-07-16実測: 1/8〜3/8で変動)。そのため、本番と同じ
// detectScenePhase をベースにし、conversation に収まる婉曲表現だけ
// subtext-escalation-classifier で補強する。scenario-runner.ts と
// score-replay.ts は共にこちらを使う。
// CI(GitHub Actions等)ではOPENROUTER_API_KEYが環境変数として直接注入され、
// .dev.vars/.envファイルは存在しないため、環境変数を優先して見る。
// 毎ターン呼ばれるためファイル読み込み結果はプロセス内でキャッシュする。
let cachedApiKey: string | null = null;
const readOpenRouterApiKey = (): string => {
  if (cachedApiKey) return cachedApiKey;
  if (process.env.OPENROUTER_API_KEY) {
    cachedApiKey = process.env.OPENROUTER_API_KEY;
    return cachedApiKey;
  }
  for (const file of [".dev.vars", ".env"]) {
    try {
      const content = fs.readFileSync(path.resolve(process.cwd(), file), "utf8");
      const match = content.match(/OPENROUTER_API_KEY\s*=\s*"?([^"\n]+)"?/);
      if (match) {
        cachedApiKey = match[1].trim();
        return cachedApiKey;
      }
    } catch {
      // 次のファイルで探す
    }
  }
  throw new Error("OPENROUTER_API_KEY not found in environment variables, .dev.vars, or .env");
};

export type LlmPhaseJudgeMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

const PHASE_ORDER: Record<Phase, number> = {
  conversation: 0,
  intimate: 1,
  erotic: 2,
  climax: 3,
  afterglow: 4,
};

const scenePhaseToPhase = (scenePhase: ScenePhase): Phase => {
  switch (scenePhase) {
    case "conversation":
      return "conversation";
    case "intimate":
      return "intimate";
    case "erotic":
      return "erotic";
    case "climax":
      return "climax";
    case "afterglow":
      return "afterglow";
  }
};

// afterglow / climax 後の下降は新シーン or 余韻移行として許容する。
// judge 側も製品の ratchet リセットと afterglow floor を反映し、二巡目以降の
// 再エスカレードを逆行として誤減点しない。
const isLegitimateSceneDrop = (previous: Phase | null, detected: Phase): boolean => {
  if (previous === null) return false;
  if (previous !== "climax" && previous !== "afterglow") return false;
  return PHASE_ORDER[previous] > PHASE_ORDER[detected];
};

const computeJudgeMonotonicViolation = (
  previousDetected: Phase | null,
  detected: Phase,
): boolean => {
  if (previousDetected === null) return false;
  const rawViolation =
    detected !== "conversation" &&
    PHASE_ORDER[previousDetected] > PHASE_ORDER[detected];
  return rawViolation && !isLegitimateSceneDrop(previousDetected, detected);
};

export async function judgePhaseWithLlm(args: {
  assistantMsg: string;
  expectedPhase: Phase;
  previousDetected: Phase | null;
  recentDetected?: Phase[];
  recentTurnsForClassifier: LlmPhaseJudgeMessage[];
}): Promise<PhaseJudgment & { llmSource: "llm" | "fallback" | "skipped" }> {
  // system メッセージは detectScenePhase 内で無視されるが、型を合わせるため除去
  const messages = args.recentTurnsForClassifier.filter((m) => m.role !== "system");
  const sceneDetected = scenePhaseToPhase(detectScenePhase(messages));

  let detected: Phase = sceneDetected;
  let llmSource: "llm" | "fallback" | "skipped" = "skipped";

  if (detected === "conversation") {
    try {
      const apiKey = readOpenRouterApiKey();
      const result = await classifySubtextEscalation({
        messages: args.recentTurnsForClassifier,
        apiKey,
        appOrigin: "https://ai-chat.app",
        // e2e:smoke はオフライン完走が前提なので、明示的な apiBase 指定が無ければ
        // ローカルモックサーバをデフォルトで向く。実モデル評価時は MOCK_API_BASE を unset する。
        // 未設定時は本番 openrouter.ai を向く。オフライン smoke は .dev.vars に
        // MOCK_API_BASE=http://127.0.0.1:8790 を設定する。
        apiBase: process.env.MOCK_API_BASE ?? "",
        // e2e judgeが評価したいのは「アシスタントの実際の返信が昇格したか」であり、
        // 「ユーザーの発言が誘いだったか」ではない(本番の既定=user_invitationのままだと
        // モデルが誘いを無視して凡庸に返しても intimate 誤判定になり、退行を見逃す)。
        judgeTarget: "assistant_reciprocation",
      });
      llmSource = result.source;
      if (result.escalate) {
        detected = "intimate";
      }
    } catch {
      llmSource = "fallback";
    }
  }

  const monotonicViolation = computeJudgeMonotonicViolation(args.previousDetected, detected);

  return {
    detected,
    monotonicViolation,
    afterglowDetected: detected === "afterglow",
    baseDetected: detected,
    llmSource,
  };
}
