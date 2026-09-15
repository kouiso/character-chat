import { describe, expect, it } from "vitest";

import { buildSubtextClassifierPrompt } from "../lib/subtext-escalation-classifier";

// 実測 2026-08-16: 前戯まで来とる場面で、同じ意図を実ユーザーが打ちそうな 13 通りで書いて
// 通したら、erotic へ上がるのは「もっと強く」「我慢できない」「脱がせるよ」の 3 通りだけやった。
// 「抱いて」「そのまま」「続けて」「もう待てない」「逃がす気ないんでしょ」は全部 intimate 止まり。
// 辞書に載っとる語で打った人だけが先へ進める状態で、語を足しても次の言い回しが漏れる。
// conversation→intimate では同じ問題を LLM への問い直しで解いてある。一段上に伸ばす。

const foreplayScene = [
  { role: "user" as const, content: "……近いね。少しだけ、手に触れてもいい？" },
  { role: "assistant" as const, content: "指先が触れて、身じろぎする。" },
  { role: "user" as const, content: "抱いて" },
];

describe("erotic_escalation の問い直し", () => {
  const prompt = buildSubtextClassifierPrompt(foreplayScene, "erotic_escalation");
  const system = prompt.find((m) => m.role === "system")?.content ?? "";

  it("前戯からの前進を判定させとる", () => {
    expect(system).toContain('"intimate" phase');
    expect(system).toContain('"erotic" phase');
    expect(system).toContain("past foreplay");
  });

  it("判定に迷ったら上げん", () => {
    expect(system).toContain("answer false");
  });

  // 辞書では拾えんかった実際の言い回しを、例として渡すところまでを固定する。
  // ここが消えると「抱いて」が通らんかった状態へ戻る。
  it.each(["抱いて", "もう待てない", "そのまま、上から", "逃がす気ないんでしょ"])(
    "%s を true 側の例として渡しとる",
    (phrase) => {
      expect(system).toContain(`user: "${phrase}" -> {"escalate":true`);
    },
  );

  it.each(["電気消して", "少し休もうか"])("%s を false 側の例として渡しとる", (phrase) => {
    expect(system).toContain(`user: "${phrase}" -> {"escalate":false`);
  });

  // 実測 2026-08-16 phase3: 「……ここ出ようか。うち、すぐ近くだから。」で erotic へ上がり、
  // まだカフェにおるのに性行為を要求された。応答は鞄の紐・髪飾り・コーヒーカップで
  // 埋まった——場所を動かせんまま分量だけ要求した時に必ず出る形。
  // 移動の提案は「行きたい」であって「もう着いた」やない。
  it("移動の提案では上げんと言うとる", () => {
    expect(system).toContain("proposes GOING somewhere");
    expect(system).toContain("have not moved yet");
  });

  it.each([
    "……ここ出ようか。うち、すぐ近くだから。",
    "ホテル行こう",
    "ベッド、そっちだよね。連れてって。",
  ])("%s を false 側の例として渡しとる", (phrase) => {
    expect(system).toContain(`user: "${phrase}" -> {"escalate":false`);
  });

  it("判定対象のターンは差し替えられとらん", () => {
    expect(prompt.map((m) => m.content).join("\n")).toContain("抱いて");
  });
});

describe("既存の judgeTarget は変えん", () => {
  it("既定は conversation→intimate のままで、erotic の文言が混ざらん", () => {
    const system =
      buildSubtextClassifierPrompt(foreplayScene).find((m) => m.role === "system")?.content ?? "";
    expect(system).toContain("euphemistic or indirect romantic/sexual invitation");
    expect(system).not.toContain("past foreplay");
  });

  it("assistant_reciprocation も従来どおり", () => {
    const system =
      buildSubtextClassifierPrompt(foreplayScene, "assistant_reciprocation").find(
        (m) => m.role === "system",
      )?.content ?? "";
    expect(system).toContain("LATEST ASSISTANT REPLY");
    expect(system).not.toContain("past foreplay");
  });
});
