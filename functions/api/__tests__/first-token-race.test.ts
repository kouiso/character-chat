import { describe, expect, it, vi } from "vitest";

import { raceFirstTokenCandidates, type FirstTokenCandidateOutcome } from "../[[route]]";

// #946: 1トークン目が遅い候補を捨てずに次候補を並走させ、先着を採るレース。
// 「捨ててから次を試す」形やと待った時間が丸ごと無駄になり、次候補の起動時間が上に積まれる。

const HEDGE_MS = 40;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** cancel が呼ばれたかを観測できる body 付きの Response を作る。 */
const makeCancellableResponse = (status = 200) => {
  const cancelled: string[] = [];
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("data: {}\n\n"));
    },
    cancel(reason) {
      cancelled.push(String(reason));
    },
  });
  return { response: new Response(stream, { status }), cancelled };
};

type Script = Record<
  string,
  { delayMs: number; outcome: () => FirstTokenCandidateOutcome | Promise<never> }
>;

const runRace = (chain: string[], script: Script) => {
  const started: string[] = [];
  const aborted: string[] = [];
  const runCandidate = async (model: string, abortController: AbortController) => {
    started.push(model);
    abortController.signal.addEventListener("abort", () => {
      aborted.push(model);
    });
    const step = script[model];
    await sleep(step.delayMs);
    return await step.outcome();
  };
  return {
    started,
    aborted,
    result: raceFirstTokenCandidates(chain, chain[0], undefined, runCandidate, HEDGE_MS),
  };
};

describe("raceFirstTokenCandidates", () => {
  it("primaryが締切前に応答したら2本目のリクエストを出さない", async () => {
    const primary = makeCancellableResponse();
    const race = runRace(["primary", "secondary"], {
      primary: {
        delayMs: 5,
        outcome: () => ({ kind: "stream", response: primary.response, usedModel: "primary" }),
      },
      secondary: {
        delayMs: 0,
        outcome: () => ({ kind: "next", lastResponse: null, usedModel: "secondary" }),
      },
    });

    const result = await race.result;
    expect(result.usedModel).toBe("primary");
    expect(race.started).toEqual(["primary"]);
    expect(primary.cancelled).toEqual([]);
  });

  it("primaryが遅い時は2本目を並走させ、先に本文を出した2本目が勝つ", async () => {
    const secondary = makeCancellableResponse();
    const race = runRace(["primary", "secondary"], {
      primary: {
        delayMs: 10_000,
        outcome: () => ({ kind: "next", lastResponse: null, usedModel: "primary" }),
      },
      secondary: {
        delayMs: 10,
        outcome: () => ({ kind: "stream", response: secondary.response, usedModel: "secondary" }),
      },
    });

    const result = await race.result;
    expect(result.usedModel).toBe("secondary");
    expect(race.started).toEqual(["primary", "secondary"]);
    expect(race.aborted).toEqual(["primary"]);
  });

  it("2本目起動後にprimaryが勝った場合はprimaryを採り、2本目を打ち切る", async () => {
    const primary = makeCancellableResponse();
    const secondary = makeCancellableResponse();
    const race = runRace(["primary", "secondary"], {
      primary: {
        delayMs: HEDGE_MS + 20,
        outcome: () => ({ kind: "stream", response: primary.response, usedModel: "primary" }),
      },
      secondary: {
        delayMs: 10_000,
        outcome: () => ({ kind: "stream", response: secondary.response, usedModel: "secondary" }),
      },
    });

    const result = await race.result;
    expect(result.usedModel).toBe("primary");
    expect(race.started).toEqual(["primary", "secondary"]);
    expect(race.aborted).toEqual(["secondary"]);
    expect(primary.cancelled).toEqual([]);
  });

  it("敗者のstreamはcancelされreaderが解放される", async () => {
    const primary = makeCancellableResponse();
    const secondary = makeCancellableResponse();
    const race = runRace(["primary", "secondary"], {
      primary: {
        delayMs: HEDGE_MS + 5,
        outcome: () => ({ kind: "stream", response: primary.response, usedModel: "primary" }),
      },
      secondary: {
        delayMs: HEDGE_MS + 60,
        outcome: () => ({ kind: "stream", response: secondary.response, usedModel: "secondary" }),
      },
    });

    const result = await race.result;
    expect(result.usedModel).toBe("primary");
    await vi.waitFor(() => {
      expect(secondary.cancelled).toEqual(["first-token-race-lost:primary"]);
    });
    expect(primary.cancelled).toEqual([]);
  });

  it("全候補が1トークン目を出せない場合は最後のレスポンスへ落ちる", async () => {
    const last = new Response("boom", { status: 502 });
    const race = runRace(["primary", "secondary"], {
      primary: {
        delayMs: 5,
        outcome: () => ({ kind: "next", lastResponse: null, usedModel: "primary" }),
      },
      secondary: {
        delayMs: 5,
        outcome: () => ({ kind: "next", lastResponse: last, usedModel: "secondary" }),
      },
    });

    const result = await race.result;
    expect(result.usedModel).toBe("secondary");
    expect(result.response.status).toBe(502);
    expect(race.started).toEqual(["primary", "secondary"]);
  });

  it("候補が1つも成功せずlastResponseも無い場合は503を返す", async () => {
    const race = runRace(["primary"], {
      primary: {
        delayMs: 1,
        outcome: () => ({ kind: "next", lastResponse: null, usedModel: "primary" }),
      },
    });

    const result = await race.result;
    expect(result.response.status).toBe(503);
  });

  it("退避対象外のHTTPステータスはそのまま返し、後続候補を起動しない", async () => {
    const forbidden = new Response("nope", { status: 403 });
    const race = runRace(["primary", "secondary"], {
      primary: {
        delayMs: 5,
        outcome: () => ({ kind: "return", response: forbidden, usedModel: "primary" }),
      },
      secondary: {
        delayMs: 0,
        outcome: () => ({ kind: "next", lastResponse: null, usedModel: "secondary" }),
      },
    });

    const result = await race.result;
    expect(result.response.status).toBe(403);
    expect(race.started).toEqual(["primary"]);
  });

  it("2本目が速攻でHTTPエラーを返しても、生成中のprimaryを打ち切らない", async () => {
    const primary = makeCancellableResponse();
    const hedgeError = makeCancellableResponse(400);
    const race = runRace(["primary", "secondary"], {
      primary: {
        delayMs: HEDGE_MS + 60,
        outcome: () => ({ kind: "stream", response: primary.response, usedModel: "primary" }),
      },
      secondary: {
        delayMs: 5,
        outcome: () => ({ kind: "return", response: hedgeError.response, usedModel: "secondary" }),
      },
    });

    const result = await race.result;
    expect(result.usedModel).toBe("primary");
    expect(result.response.status).toBe(200);
    // 投機的な2本目のエラーでprimaryが中断されたらアウト。
    expect(race.aborted).toEqual([]);
    expect(primary.cancelled).toEqual([]);
    // 使わんかったエラーレスポンスのbodyは解放しておく。
    await vi.waitFor(() => {
      expect(hedgeError.cancelled).toEqual(["first-token-race-lost:primary"]);
    });
  });

  it("保留した2本目のエラーは、primaryも落ちた時点で結論として返る", async () => {
    const hedgeError = makeCancellableResponse(400);
    const race = runRace(["primary", "secondary"], {
      primary: {
        delayMs: HEDGE_MS + 60,
        outcome: () => ({ kind: "next", lastResponse: null, usedModel: "primary" }),
      },
      secondary: {
        delayMs: 5,
        outcome: () => ({ kind: "return", response: hedgeError.response, usedModel: "secondary" }),
      },
    });

    const result = await race.result;
    expect(result.usedModel).toBe("secondary");
    expect(result.response.status).toBe(400);
    // primaryは自力で終わるまで走り切る。エラーを理由に打ち切られとったらアウト。
    expect(race.aborted).toEqual([]);
    expect(hedgeError.cancelled).toEqual([]);
  });

  it("完了順が前後しても、一番奥まで試した候補の失敗を結論に残す", async () => {
    const primaryFailure = makeCancellableResponse(504);
    const hedgeFailure = makeCancellableResponse(400);
    const race = runRace(["primary", "secondary"], {
      primary: {
        delayMs: HEDGE_MS + 60,
        outcome: () => ({
          kind: "next",
          lastResponse: primaryFailure.response,
          usedModel: "primary",
        }),
      },
      secondary: {
        delayMs: 5,
        outcome: () => ({
          kind: "next",
          lastResponse: hedgeFailure.response,
          usedModel: "secondary",
        }),
      },
    });

    const result = await race.result;
    // 最後に落ちたのは primary やが、退避連鎖として奥なのは secondary。
    expect(result.usedModel).toBe("secondary");
    expect(result.response.status).toBe(400);
    await vi.waitFor(() => {
      expect(primaryFailure.cancelled).toEqual(["superseded-first-token-failure"]);
    });
  });

  it("並走は2本までに制限され、3本目は片方が脱落してから起動する", async () => {
    const third = makeCancellableResponse();
    const race = runRace(["a", "b", "c"], {
      a: { delayMs: 10_000, outcome: () => ({ kind: "next", lastResponse: null, usedModel: "a" }) },
      b: {
        delayMs: HEDGE_MS + 10,
        outcome: () => ({ kind: "next", lastResponse: null, usedModel: "b" }),
      },
      c: {
        delayMs: 5,
        outcome: () => ({ kind: "stream", response: third.response, usedModel: "c" }),
      },
    });

    await sleep(HEDGE_MS + 5);
    expect(race.started).toEqual(["a", "b"]);

    const result = await race.result;
    expect(result.usedModel).toBe("c");
    expect(race.started).toEqual(["a", "b", "c"]);
  });
});
