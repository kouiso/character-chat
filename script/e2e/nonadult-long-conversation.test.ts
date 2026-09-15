import { describe, expect, it } from "vitest";

import {
  NON_ADULT_LONG_CONVERSATION_INPUTS,
  runNonAdultLongConversation,
} from "./nonadult-long-conversation";

const markers = [..."亜伊宇江於加幾久計己左之須世曽多知津天止奈仁奴祢乃波比不辺保"];

const response = (turn: number): string => {
  const marker = markers[turn - 1] ?? String(turn);
  return [
    `data: ${JSON.stringify({
      model: "test-model",
      choices: [
        {
          delta: {
            content: `<response><action>${marker.repeat(18)}。</action>`,
          },
        },
      ],
    })}`,
    `data: ${JSON.stringify({
      choices: [
        {
          delta: {
            content: `<dialogue>「${marker.repeat(16)}」</dialogue><inner>${marker.repeat(20)}。</inner></response>`,
          },
        },
      ],
    })}`,
    "data: [DONE]",
  ].join("\n");
};

describe("runNonAdultLongConversation", () => {
  it("conversationフェーズだけで30ターンを実走し、後半の反復とp95を判定する", async () => {
    let requestCount = 0;
    let nowValue = 0;
    const result = await runNonAdultLongConversation({
      baseUrl: "https://example.test/",
      email: "qa@example.test",
      authToken: "test-auth-token",
      basicAuthUser: "test-user",
      basicAuthPass: "test-pass",
      now: () => {
        nowValue += 100;
        return nowValue;
      },
      fetchImpl: async (_input, init) => {
        requestCount += 1;
        const body = JSON.parse(String(init?.body)) as {
          messages: Array<{ role: string; content: string }>;
          scenePhase: string;
        };
        expect(new Headers(init?.headers).get("Authorization")).toBe(
          `Basic ${Buffer.from("test-user:test-pass").toString("base64")}`,
        );
        expect(body.scenePhase).toBe("conversation");
        expect(body.messages.at(-1)?.content).toBe(
          NON_ADULT_LONG_CONVERSATION_INPUTS[requestCount - 1],
        );
        return new Response(response(requestCount), {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      },
    });

    expect(requestCount).toBe(30);
    expect(result).toMatchObject({
      scenarioId: "nonadult-daily-conversation-v1",
      phase: "conversation",
      turnCount: 30,
      apiErrorCount: 0,
      lateTurn: {
        startTurn: 22,
        turnCount: 9,
        repetitionLoopOccurrences: 0,
        repeatedTurnIndexes: [],
        p95LatencyMs: 100,
      },
      passed: true,
    });
    expect(result.turns).toHaveLength(30);
    expect(result.turns.every((turn) => turn.assistantChars > 0)).toBe(true);
    expect(NON_ADULT_LONG_CONVERSATION_INPUTS.at(-1)).not.toContain("振り返");
  });

  // サーバーは1ターンで複数回の生成を同じストリームに載せ、境界は event: regenerating だけで示す。
  // data: 行しか見んと、ユーザーへ届いてない不採用の本文まで assistant として集計・履歴投入する。
  it("作り直しが起きたターンで不採用の試行を本文に混ぜない", async () => {
    let servedModel: string | null = null;
    const rejected = "不採用になった一回目の本文";
    const served = `<response><action>${"採".repeat(18)}。</action><dialogue>「${"用".repeat(16)}」</dialogue><inner>${"文".repeat(20)}。</inner></response>`;

    const result = await runNonAdultLongConversation({
      baseUrl: "https://example.test",
      email: "qa@example.test",
      now: () => 0,
      fetchImpl: async () =>
        new Response(
          [
            `data: ${JSON.stringify({ model: "first-attempt-model", choices: [{ delta: { content: rejected } }] })}\n`,
            "event: regenerating\ndata: {}\n\n",
            `data: ${JSON.stringify({ model: "retry-model", choices: [{ delta: { content: served } }] })}\n`,
            `event: quality-meta\ndata: ${JSON.stringify({ retryCount: 1, refusalDetected: true, usedModel: "retry-model", warningLevel: false, refusalRetryCount: 1 })}\n\n`,
            "data: [DONE]\n",
          ].join(""),
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        ),
      onTurn: (turn) => {
        servedModel ??= turn.servedModel;
      },
    });

    expect(result.turns[0].assistantChars).toBe(served.length);
    expect(servedModel).toBe("retry-model");
  });

  // 中継開始後の失敗は HTTP 200 + event: error + [DONE] なしで届く。
  // 途中まで出た本文が残っとるので、見落とすと成功ターンとして集計される。
  it("中継開始後に落ちたストリームを成功扱いしない", async () => {
    await expect(
      runNonAdultLongConversation({
        baseUrl: "https://example.test",
        email: "qa@example.test",
        fetchImpl: async () =>
          new Response(
            [
              `data: ${JSON.stringify({ choices: [{ delta: { content: "途中まで出た本文" } }] })}\n\n`,
              `event: error\ndata: ${JSON.stringify({ reason: "upstream service error" })}\n\n`,
            ].join(""),
            { status: 200, headers: { "Content-Type": "text/event-stream" } },
          ),
      }),
    ).rejects.toThrow("chat stream did not complete");
  });

  it("APIエラーを成功扱いしない", async () => {
    await expect(
      runNonAdultLongConversation({
        baseUrl: "https://example.test",
        email: "qa@example.test",
        fetchImpl: async () => new Response("", { status: 503 }),
      }),
    ).rejects.toThrow("chat API returned HTTP 503");
  });
});
