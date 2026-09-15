import { describe, expect, it } from "vitest";

import { detectScenePhaseCandidates, type ScenePhase } from "../../../src/lib/scene-phase";
import {
  buildPhaseDeEscalationPrompt,
  classifyPhaseDeEscalation,
  parsePhaseDeEscalationDecision,
  resolveClientScenePhaseOverride,
  resolvePhaseAfterDeEscalation,
  shouldAskPhaseDeEscalation,
} from "../lib/phase-de-escalation-classifier";

// 直前のターンでエロ段階へ入っとる会話。曖昧語（いく／出して／果て）はこの段階でだけ
// 絶頂として効くので、誤判定もここでしか起きん。
const eroticSceneSoFar = [
  { role: "user", content: "挿入して" },
  { role: "assistant", content: "……うん" },
];

const conversationWith = (latestUserMessage: string) => [
  ...eroticSceneSoFar,
  { role: "user", content: latestUserMessage },
];

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "text/plain" } });

const classifierReplying = (content: string): typeof fetch =>
  (async () => jsonResponse({ choices: [{ message: { content } }] })) as unknown as typeof fetch;

const runDeEscalation = async (input: {
  latestUserMessage: string;
  fetchImpl: typeof fetch;
  timeoutMs?: number;
}): Promise<{ phase: ScenePhase; asked: boolean; reason: string }> => {
  const messages = conversationWith(input.latestUserMessage);
  const { phase: keywordPhase, ambiguousFallbackPhase } = detectScenePhaseCandidates(messages);
  const asked = shouldAskPhaseDeEscalation({ keywordPhase, ambiguousFallbackPhase });

  if (!asked || ambiguousFallbackPhase === null) {
    return { phase: keywordPhase, asked: false, reason: "not_asked" };
  }

  const decision = await classifyPhaseDeEscalation({
    messages: messages as { role: "user" | "assistant"; content: string }[],
    keywordPhase,
    fallbackPhase: ambiguousFallbackPhase,
    apiKey: "test-key",
    appOrigin: "https://example.test",
    routerModel: "test/router",
    fallbackModels: [],
    timeoutMs: input.timeoutMs ?? 4000,
    fetchImpl: input.fetchImpl,
  });

  return {
    phase: resolvePhaseAfterDeEscalation({ keywordPhase, ambiguousFallbackPhase, decision }),
    asked: true,
    reason: decision.reason,
  };
};

describe("曖昧語で立ったフェーズの LLM 問い直し", () => {
  it("「いくつか」は絶頂やないと判定されたら erotic へ落ちる", async () => {
    const result = await runDeEscalation({
      latestUserMessage: "いくつか聞きたいことがある",
      fetchImpl: classifierReplying(
        '{"ordinary_language":true,"reason":"counting, not a climax utterance"}',
      ),
    });

    expect(result.asked).toBe(true);
    expect(result.phase).toBe("erotic");
  });

  it("「元気出して」は絶頂やないと判定されたら erotic へ落ちる", async () => {
    const result = await runDeEscalation({
      latestUserMessage: "元気出して",
      fetchImpl: classifierReplying('{"ordinary_language":true,"reason":"encouragement"}'),
    });

    expect(result.asked).toBe(true);
    expect(result.phase).toBe("erotic");
  });

  it("曖昧語でも本物の絶頂表現やと判定されたら climax のまま残る", async () => {
    const result = await runDeEscalation({
      latestUserMessage: "いっぱい出して",
      fetchImpl: classifierReplying('{"ordinary_language":false,"reason":"climax request"}'),
    });

    expect(result.asked).toBe(true);
    expect(result.phase).toBe("climax");
  });

  it("曖昧語やない絶頂表現には問い直し自体を投げず climax のまま", async () => {
    const neverCalled: typeof fetch = (() => {
      throw new Error("classifier must not be called for unambiguous climax lines");
    }) as unknown as typeof fetch;

    const result = await runDeEscalation({
      latestUserMessage: "もうイッちゃう",
      fetchImpl: neverCalled,
    });

    expect(result.asked).toBe(false);
    expect(result.phase).toBe("climax");
  });

  it("タイムアウトしたらキーワード判定の climax を残す", async () => {
    const hangingFetch: typeof fetch = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as unknown as typeof fetch;

    const result = await runDeEscalation({
      latestUserMessage: "いくつか聞きたいことがある",
      fetchImpl: hangingFetch,
      timeoutMs: 20,
    });

    expect(result.asked).toBe(true);
    expect(result.phase).toBe("climax");
    expect(result.reason).toBe("classifier_call_failed");
  });

  it("classifier がエラーを返してもキーワード判定の climax を残す", async () => {
    const failingFetch: typeof fetch = (async () =>
      new Response("upstream exploded", { status: 500 })) as unknown as typeof fetch;

    const result = await runDeEscalation({
      latestUserMessage: "元気出して",
      fetchImpl: failingFetch,
      timeoutMs: 50,
    });

    expect(result.asked).toBe(true);
    expect(result.phase).toBe("climax");
    expect(result.reason).toBe("classifier_http_500");
  });

  it("boolean が読めん応答は降格させん", () => {
    expect(parsePhaseDeEscalationDecision("たぶん日常語やと思います (true)")).toEqual({
      deEscalate: false,
      reason: "unparseable_decision",
    });
    expect(parsePhaseDeEscalationDecision('{"reason":"no verdict"}').deEscalate).toBe(false);
  });

  it("コードフェンス付きの JSON でも読める", () => {
    expect(
      parsePhaseDeEscalationDecision('```json\n{"ordinary_language":true,"reason":"ok"}\n```')
        .deEscalate,
    ).toBe(true);
  });
});

// 2026-07-26 の敵対レビューで立った指摘の回帰テスト。
describe("曖昧語ゲートの文脈", () => {
  it("同じターンにエロ語があれば曖昧語を絶頂として読む", () => {
    expect(
      detectScenePhaseCandidates([{ role: "user", content: "奥まで突いて、いく" }]).phase,
    ).toBe("climax");
    expect(
      detectScenePhaseCandidates([{ role: "user", content: "奥まで入れて、出して" }]).phase,
    ).toBe("climax");
  });

  it("soft intimacy の積み上げで到達した erotic も曖昧語の文脈になる", () => {
    const softProgression = [
      { role: "user", content: "手を握ってもいい？" },
      { role: "user", content: "もっと近くにいたい" },
      { role: "user", content: "あなたに甘えたい" },
    ];

    expect(detectScenePhaseCandidates(softProgression).phase).toBe("erotic");
    // 絶頂語を足してフェーズが下がることは無い
    expect(
      detectScenePhaseCandidates([...softProgression, { role: "user", content: "いく" }]).phase,
    ).toBe("climax");
  });

  it("「いきたい」は日常語なのでエロ文脈が要る", () => {
    expect(detectScenePhaseCandidates([{ role: "user", content: "旅行にいきたい" }]).phase).toBe(
      "conversation",
    );
    expect(
      detectScenePhaseCandidates([...eroticSceneSoFar, { role: "user", content: "いきたい" }])
        .phase,
    ).toBe("climax");
  });

  it("assistant が曖昧語で絶頂を描写しても climax を維持する", () => {
    const narrated = (line: string) => [
      { role: "user", content: "奥まで突いて" },
      { role: "assistant", content: line },
      { role: "user", content: "そのまま" },
    ];

    expect(detectScenePhaseCandidates(narrated("彼女はついに果てた")).phase).toBe("climax");
    expect(detectScenePhaseCandidates(narrated("全部出してしまった")).phase).toBe("climax");
  });

  it("降格の落とし先は最新ターン以前が到達しとる段階より下げん", () => {
    const { ambiguousFallbackPhase } = detectScenePhaseCandidates([
      { role: "user", content: "手を握ってもいい？" },
      { role: "user", content: "もっと近くにいたい" },
      { role: "user", content: "あなたに甘えたい" },
      { role: "user", content: "いく" },
    ]);

    expect(ambiguousFallbackPhase).toBe("erotic");
  });
});

describe("classifier へ渡す本文", () => {
  it("長い最新ターンでも末尾の曖昧語を落とさん", () => {
    const longAction = `${"彼女の髪をなでながらゆっくりと抱き寄せる。".repeat(60)}いっぱい出して`;
    const prompt = buildPhaseDeEscalationPrompt({
      messages: [{ role: "user", content: longAction }],
      keywordPhase: "climax",
      fallbackPhase: "erotic",
    });

    expect(longAction.length).toBeGreaterThan(500);
    expect(prompt[1].content).toContain("いっぱい出して");
  });
});

describe("問い直しの対象ターン", () => {
  it("曖昧語がフェーズを押し上げとらんターンは対象外", () => {
    const { phase, ambiguousFallbackPhase } = detectScenePhaseCandidates(
      conversationWith("もっと突いて"),
    );

    expect(phase).toBe("erotic");
    expect(ambiguousFallbackPhase).toBeNull();
    expect(shouldAskPhaseDeEscalation({ keywordPhase: phase, ambiguousFallbackPhase })).toBe(false);
  });

  it("平場の会話に混ざった曖昧語は元からフェーズを上げんので対象外", () => {
    const { phase, ambiguousFallbackPhase } = detectScenePhaseCandidates([
      { role: "user", content: "いくつか聞きたいことがある" },
    ]);

    expect(phase).toBe("conversation");
    expect(ambiguousFallbackPhase).toBeNull();
  });
});

describe("クライアントが送ってくる scenePhase の扱い", () => {
  const messages = [
    { role: "user", content: "挿入して" },
    { role: "assistant", content: "……うん" },
    { role: "user", content: "元気出して" },
  ];

  it("同じキーワード判定の写しは固定扱いにせず問い直しへ回す", () => {
    const { phase, ambiguousFallbackPhase } = detectScenePhaseCandidates(messages);

    expect(phase).toBe("climax");
    expect(
      resolveClientScenePhaseOverride({
        clientScenePhase: phase,
        keywordPhase: phase,
        ambiguousFallbackPhase,
      }),
    ).toBeUndefined();
  });

  it("サーバ判定と違う明示指定はこれまで通り優先する", () => {
    const { phase, ambiguousFallbackPhase } = detectScenePhaseCandidates(messages);

    expect(
      resolveClientScenePhaseOverride({
        clientScenePhase: "intimate" as ScenePhase,
        keywordPhase: phase,
        ambiguousFallbackPhase,
      }),
    ).toBe("intimate");
  });

  it("曖昧語で立っとらんターンの写しは固定のまま尊重する", () => {
    const unambiguous = [
      { role: "user", content: "挿入して" },
      { role: "assistant", content: "……うん" },
      { role: "user", content: "もうイッちゃう" },
    ];
    const { phase, ambiguousFallbackPhase } = detectScenePhaseCandidates(unambiguous);

    expect(ambiguousFallbackPhase).toBeNull();
    expect(
      resolveClientScenePhaseOverride({
        clientScenePhase: phase,
        keywordPhase: phase,
        ambiguousFallbackPhase,
      }),
    ).toBe("climax");
  });
});
