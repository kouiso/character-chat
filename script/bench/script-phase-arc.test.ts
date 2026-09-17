import { describe, expect, it } from "vitest";

import { detectScenePhase } from "../../src/lib/scene-phase";

import { BENCH_SCRIPTS } from "./scripts";

// 台本の「あなた」発言を書き換えた時に、サーバの phase 検出が意図した段を辿るかを
// ここで潰す。2026-09-17: 口説き文句を自然なものへ直したら「嫌」「今日はここまで」の
// 離脱cueや、soft cue しか持たんターンが紛れて、intimate の連続が切れ t7 が
// erotic へ届かん設計になっとった。実走行（金のかかるLLM呼び出し）の前に気づく門。
const NEUTRAL_ASSISTANT = {
  role: "assistant" as const,
  content:
    "<response><action>うなずいて、言葉を待つ。</action><dialogue>「……うん」</dialogue></response>",
};

const runScriptPhases = (script: readonly { intent: string; user: string }[]) => {
  const messages: { role: "user" | "assistant"; content: string }[] = [];
  const phases: string[] = [];
  for (const turn of script) {
    messages.push({ role: "user", content: turn.user });
    phases.push(detectScenePhase(messages));
    messages.push(NEUTRAL_ASSISTANT);
  }
  return phases;
};

describe("台本の「あなた」発言は意図した段を辿る", () => {
  // 中立の assistant 応答だけでユーザー発話側の cue が段を運べるかを見る。
  // sakura 台本はそれを前提に設計されとる（downer 側は assistant の床で上がる設計なので
  // この検査の対象外。scene-phase.ts の resolveAssistantSceneFloor コメント参照）。
  it("sakura: 会話→親密→性行為→絶頂→余韻の順に配信される", () => {
    expect(runScriptPhases(BENCH_SCRIPTS.sakura)).toStrictEqual([
      "conversation",
      "conversation",
      "conversation",
      "intimate",
      "intimate",
      "intimate",
      "erotic",
      "erotic",
      "climax",
      "afterglow",
    ]);
  });
});
