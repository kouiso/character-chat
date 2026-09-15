import { describe, expect, it } from "vitest";

import { classifyFailure } from "./failure-taxonomy";
import {
  DEFAULT_SEND_TURN_BUDGET,
  SendTurnError,
  computeSendPhaseTimeoutMs,
  fitSendPhaseToRemaining,
  sendTurnMessage,
  type ComposerState,
  type SendTurnDeps,
} from "./send-turn";

type HarnessOptions = {
  /** textarea.disabled === isLoading。true の間は送信できない。 */
  loading: (elapsedMs: number) => boolean;
  /** click が実際に user message を DOM へ追加するか。 */
  clickAddsMessage?: (clickCount: number) => boolean;
  baseline?: number;
  fillFails?: boolean;
  /** composer がそもそも描画されていない（遷移失敗・クラッシュ）。 */
  textareaMissing?: boolean;
  /** 直前ターンの click の反映が遅れて届く時刻。 */
  lateEchoAtMs?: number;
};

const createHarness = (options: HarnessOptions) => {
  const baseline = options.baseline ?? 4;
  let clock = 0;
  let text = "";
  let rendered = baseline;
  let clicks = 0;
  const clickTimes: number[] = [];

  const state = (): ComposerState => {
    const loading = options.loading(clock);
    if (
      options.lateEchoAtMs !== undefined &&
      clock >= options.lateEchoAtMs &&
      rendered === baseline
    ) {
      rendered += 2;
    }
    const missing = options.textareaMissing === true;
    return {
      textareaFound: !missing,
      textareaDisabled: missing || loading,
      textareaLength: text.length,
      buttonFound: !missing,
      buttonDisabled: missing || loading || text.length === 0,
      renderedMessageCount: rendered,
    };
  };

  const deps: SendTurnDeps = {
    readComposerState: async () => state(),
    dismissPhotoOverlay: async () => undefined,
    fillInput: async (value) => {
      if (options.fillFails) throw new Error("fill failed");
      if (options.loading(clock)) throw new Error("element is not enabled");
      text = value;
    },
    clickSendIfEnabled: async () => {
      const current = state();
      // 本物の clickSendIfEnabledInPage と同じく、click 直前(同一タスク内)の描画数を
      // click の成否に関わらず返す。呼び出し側はこれを baseline として使う。
      const renderedMessageCount = current.renderedMessageCount;
      if (current.buttonDisabled) return { clicked: false, renderedMessageCount };
      clicks += 1;
      clickTimes.push(clock);
      const effective = options.clickAddsMessage?.(clicks) ?? true;
      if (effective) {
        // handleSend は user と assistant のプレースホルダーを続けて追加する。
        rendered += 2;
        text = "";
      }
      return { clicked: true, renderedMessageCount };
    },
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
  };

  return {
    deps,
    baseline,
    elapsed: () => clock,
    clicks: () => clicks,
    clickTimes: () => clickTimes,
    rendered: () => rendered,
  };
};

describe("sendTurnMessage", () => {
  it("sends on the first attempt when the composer is idle", async () => {
    const harness = createHarness({ loading: () => false });

    const outcome = await sendTurnMessage(harness.deps, {
      turnIndex: 3,
      text: "こんばんは",
      baselineMessageCount: harness.baseline,
    });

    expect(outcome.attempts).toBe(1);
    expect(harness.clicks()).toBe(1);
    expect(harness.rendered()).toBe(harness.baseline + 2);
  });

  it("waits for a slow persistence unlock instead of failing", async () => {
    const harness = createHarness({ loading: (elapsed) => elapsed < 8_000 });

    const outcome = await sendTurnMessage(harness.deps, {
      turnIndex: 5,
      text: "ねえ",
      baselineMessageCount: harness.baseline,
    });

    expect(outcome.attempts).toBe(1);
    expect(harness.clicks()).toBe(1);
  });

  // #993 の本体。isLoading が戻らないと 300 秒黙って止まっていた。
  it("fails fast and loudly with composer_locked when isLoading never clears", async () => {
    const harness = createHarness({ loading: () => true });

    const error = await sendTurnMessage(harness.deps, {
      turnIndex: 7,
      text: "つづき",
      baselineMessageCount: harness.baseline,
    }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(SendTurnError);
    const sendError = error as SendTurnError;
    expect(sendError.code).toBe("composer_locked");
    expect(sendError.message).toContain("turn-7-send blocked: composer_locked");
    expect(sendError.message).toContain("textarea=disabled");
    // 原因が turn_timeout へ丸められないよう "timed out" は含めない。
    expect(sendError.message).not.toContain("timed out");
    expect(harness.clicks()).toBe(0);
    const ceiling =
      DEFAULT_SEND_TURN_BUDGET.composerUnlockFirstMs +
      DEFAULT_SEND_TURN_BUDGET.composerUnlockRetryMs * 2 +
      10_000;
    expect(harness.elapsed()).toBeLessThan(ceiling);
    // 旧実装の 300 秒サイレントストール（turn_timeout）に戻っていないこと。
    expect(harness.elapsed()).toBeLessThan(300_000);
  });

  // textarea が無いのは isLoading の滞留やない。画面が出てへん（遷移失敗・クラッシュ）。
  // composer_locked と同じコードで出すと、動いてすらいない run がアプリ側の
  // ストリーム滞留として集計される。
  it("reports composer_missing when the composer never mounted", async () => {
    const harness = createHarness({ loading: () => false, textareaMissing: true });

    const error = await sendTurnMessage(harness.deps, {
      turnIndex: 8,
      text: "おはよう",
      baselineMessageCount: harness.baseline,
    }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(SendTurnError);
    const sendError = error as SendTurnError;
    expect(sendError.code).toBe("composer_missing");
    expect(sendError.message).toContain("textarea=missing");
    expect(harness.clicks()).toBe(0);
    expect(harness.elapsed()).toBeLessThan(300_000);
  });

  it("resends when a click fires but no user message reaches the DOM", async () => {
    const harness = createHarness({
      loading: () => false,
      clickAddsMessage: (clickCount) => clickCount > 1,
    });

    const outcome = await sendTurnMessage(harness.deps, {
      turnIndex: 9,
      text: "もっと",
      baselineMessageCount: harness.baseline,
    });

    expect(outcome.attempts).toBe(2);
    expect(harness.clicks()).toBe(2);
    expect(harness.rendered()).toBe(harness.baseline + 2);
  });

  // 再送した時、実際にサーバへ届いたのが何回目の click かは分からない。後の click の
  // 時刻を返すと、受理された要求の lastChatRequestAt がそれより前になり、
  // waitForStreamComplete が自分のターンの要求を弾いてストリーム待ちを使い切る。
  it("reports the first click time, not a later retry's, so the stream wait accepts the request", async () => {
    const harness = createHarness({
      loading: () => false,
      clickAddsMessage: (clickCount) => clickCount > 1,
    });

    const outcome = await sendTurnMessage(harness.deps, {
      turnIndex: 9,
      text: "もっと",
      baselineMessageCount: harness.baseline,
    });

    const times = harness.clickTimes();
    expect(times).toHaveLength(2);
    expect(times[1]).toBeGreaterThan(times[0]);
    // 返る値は1回目の click 時刻。2回目を返すと、受理されたのが1回目だった場合に弾かれる。
    expect(outcome.sendIssuedAt).toBe(times[0]);
  });

  // click する前の増加は、挨拶の描画・建て直し・前ターンの遅れた反映のどれか。
  // 自分の発言として受け取ると、台本の発言を送らないまま次へ進む。
  it("still sends when the count rose before this turn ever clicked", async () => {
    const harness = createHarness({ loading: () => false, lateEchoAtMs: 0 });

    const outcome = await sendTurnMessage(harness.deps, {
      turnIndex: 4,
      text: "台本どおりの発言",
      baselineMessageCount: harness.baseline,
    });

    expect(harness.clicks()).toBe(1);
    expect(outcome.sendIssuedAt).toBe(harness.clickTimes()[0]);
  });

  it("reports send_click_no_effect when every click is swallowed", async () => {
    const harness = createHarness({
      loading: () => false,
      clickAddsMessage: () => false,
    });

    const error = await sendTurnMessage(harness.deps, {
      turnIndex: 11,
      text: "ねえ",
      baselineMessageCount: harness.baseline,
    }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(SendTurnError);
    expect((error as SendTurnError).code).toBe("send_click_no_effect");
    expect(harness.clicks()).toBe(DEFAULT_SEND_TURN_BUDGET.attempts);
    expect(harness.elapsed()).toBeLessThan(300_000);
  });

  // 入場時に読んだ baseline が古く、期待値が最初から満たされて見えることがある。
  // 前ターンの吹き出しが baseline を読んだ後に描画された場合で、増えた1件はこのターンの
  // 発言やない。これを自分の発言として受け取ると、台本の発言を送らないまま完了扱いになる
  // （#993 の「送られてへんのに通る」と同じ形）。click してから拾う。
  it("still sends this turn's text when the entry baseline was stale", async () => {
    const harness = createHarness({ loading: () => false, baseline: 4 });

    const outcome = await sendTurnMessage(harness.deps, {
      turnIndex: 13,
      text: "ん",
      baselineMessageCount: harness.baseline - 1,
    });

    expect(outcome.attempts).toBe(1);
    expect(harness.clicks()).toBe(1);
  });

  // 入場時 baseline が1件古く、かつ1回目の click が空振りした場合。
  // 期待値を入場時 baseline から組むと、click 前から baseline+1 に達しているため、
  // 2周目の頭で「増えた」と読んで成功で返る。自分は1件も足していない。
  // click 済みの判定だけでは防げない（1回目の click は発火しとる）ので、
  // 基準を click 直前の観測数へ寄せる必要がある。
  it("does not mistake a stale entry baseline for its own echo after a swallowed click", async () => {
    const harness = createHarness({
      loading: () => false,
      baseline: 4,
      clickAddsMessage: (clickCount) => clickCount > 1,
    });

    const outcome = await sendTurnMessage(harness.deps, {
      turnIndex: 23,
      text: "これは必ず送る",
      // 入場時に読んだ数が実際より1件少ない（前ターンの吹き出しが後から描画された）。
      baselineMessageCount: harness.baseline - 1,
    });

    // 空振りを成功と読まず、2回目を click して初めて成功する。
    expect(harness.clicks()).toBe(2);
    expect(outcome.attempts).toBe(2);
    expect(harness.rendered()).toBe(harness.baseline + 2);
    expect(outcome.renderedBeforeSend).toBe(harness.baseline);
  });

  it("reports fill_failed when the input never accepts text", async () => {
    const harness = createHarness({ loading: () => false, fillFails: true });

    const error = await sendTurnMessage(harness.deps, {
      turnIndex: 15,
      text: "やめて",
      baselineMessageCount: harness.baseline,
    }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(SendTurnError);
    expect((error as SendTurnError).code).toBe("fill_failed");
    expect(harness.elapsed()).toBeLessThan(300_000);
  });
});

// 解除待ちの最中に吹き出しが増えることがある。自分がまだ click してへん以上、それは
// 前ターン・挨拶・建て直しのどれかで、このターンの発言やない。送らずに完了扱いにすると、
// 台本の発言が抜けたまま結果だけが残る。
describe("late echo during the unlock wait", () => {
  it("sends this turn's text once the composer unlocks", async () => {
    const harness = createHarness({
      loading: (elapsed) => elapsed < 20_000,
      lateEchoAtMs: 3_000,
    });

    const outcome = await sendTurnMessage(harness.deps, {
      turnIndex: 17,
      text: "また",
      baselineMessageCount: harness.baseline,
    });

    expect(outcome.attempts).toBe(1);
    expect(harness.clicks()).toBe(1);
  });

  it("fails loudly when the composer never unlocks, instead of counting someone else's bubble", async () => {
    const harness = createHarness({ loading: () => true, lateEchoAtMs: 5_000 });

    const error = await sendTurnMessage(harness.deps, {
      turnIndex: 19,
      text: "ん",
      baselineMessageCount: harness.baseline,
    }).catch((err: unknown) => err);

    // 送れてへんことを黙って成功にせん。原因が残る形で落とす。
    expect(error).toBeInstanceOf(SendTurnError);
    expect((error as SendTurnError).code).toBe("composer_locked");
    expect(harness.clicks()).toBe(0);
  });
});

// 前ターンのロールバックで吹き出しが減ると、入場時 baseline では期待値に届かない。
describe("rendered baseline refresh", () => {
  it("reports the count observed just before the click", async () => {
    const harness = createHarness({ loading: () => false, baseline: 8 });

    const outcome = await sendTurnMessage(harness.deps, {
      turnIndex: 21,
      text: "そろそろ",
      baselineMessageCount: 8,
    });

    expect(outcome.renderedBeforeSend).toBe(8);
    expect(harness.rendered()).toBe(outcome.renderedBeforeSend + 2);
  });
});

describe("send phase budget", () => {
  // 外側の withTimeout が内側の総和より短いと、固有コードが "timed out" に潰れる（#993 の再来）。
  it("covers every inner wait so the outer wrapper never fires first", () => {
    const budget = DEFAULT_SEND_TURN_BUDGET;
    const innerWorstCase =
      budget.composerUnlockFirstMs +
      budget.composerUnlockRetryMs * (budget.attempts - 1) +
      (budget.fillMs + budget.buttonEnableMs + budget.echoMs) * budget.attempts;

    // 呼び出し側は送信後の echo settle と前処理ぶんを余白に足す。
    const cap = computeSendPhaseTimeoutMs(budget, 45_000);
    expect(cap).toBeGreaterThan(innerWorstCase + 15_000);
    // ターン予算 300 秒より内側に収まっていること。
    expect(cap).toBeLessThan(300_000);
  });
});

// シナリオ終盤は残り時間がターン予算より短くなる。外側だけ Math.min で切ると
// 内側が終わる前に外側が発火し、composer_locked が "turn-N-send timed out" へ潰れる。
describe("send phase budget under a short remaining scenario time", () => {
  const margin = 45_000;

  it("keeps the full budget while there is enough time left", () => {
    const full = computeSendPhaseTimeoutMs(DEFAULT_SEND_TURN_BUDGET, margin);
    const fitted = fitSendPhaseToRemaining(300_000, DEFAULT_SEND_TURN_BUDGET, margin);

    expect(fitted.factor).toBe(1);
    expect(fitted.budget).toEqual(DEFAULT_SEND_TURN_BUDGET);
    expect(fitted.timeoutMs).toBe(full);
  });

  it("shrinks the inner waits so the outer cap still exceeds their sum", () => {
    const availableMs = 60_000;
    const fitted = fitSendPhaseToRemaining(availableMs, DEFAULT_SEND_TURN_BUDGET, margin);
    const b = fitted.budget;
    const innerWorstCase =
      b.composerUnlockFirstMs +
      b.composerUnlockRetryMs * (b.attempts - 1) +
      (b.fillMs + b.buttonEnableMs + b.echoMs) * b.attempts;

    expect(fitted.timeoutMs).toBe(availableMs);
    expect(innerWorstCase).toBeLessThan(fitted.timeoutMs);
    // 回数は削らない。削ると「1 回目は空振り、2 回目で通る」形が取れなくなる。
    expect(b.attempts).toBe(DEFAULT_SEND_TURN_BUDGET.attempts);
  });

  // #993 の再来そのもの。縮めた予算なら、外側が発火する前に固有コードが出る。
  it("still emits composer_locked before the outer cap would fire", async () => {
    const availableMs = 60_000;
    const fitted = fitSendPhaseToRemaining(availableMs, DEFAULT_SEND_TURN_BUDGET, margin);
    const harness = createHarness({ loading: () => true });

    const error = await sendTurnMessage(harness.deps, {
      turnIndex: 25,
      text: "終盤の発言",
      baselineMessageCount: harness.baseline,
      budget: fitted.budget,
    }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(SendTurnError);
    expect((error as SendTurnError).code).toBe("composer_locked");
    expect((error as SendTurnError).message).not.toContain("timed out");
    // 外側が先に発火していたら、この時間内には落ちきっていない。
    expect(harness.elapsed()).toBeLessThan(fitted.timeoutMs);
  });
});

describe("send failure classification", () => {
  // 新しい失敗コードは "timed out" を含まないため、明示しないと test.flaky へ落ちる。
  // composer_locked も streaming_stall。isLoading はストリーム中も立っており、
  // 永続化が始まる前の滞留と区別できないため app.persistence とは断定しない。
  // composer_missing だけは env 側。画面が出ていない run をストリーム滞留として
  // 集計すると、アプリの品質問題と実行環境の故障が混ざる。
  it.each([
    ["composer_locked", "app.streaming_stall"],
    ["send_click_no_effect", "app.streaming_stall"],
    ["composer_missing", "env.service_down"],
    ["send_button_never_enabled", "test.flaky"],
    ["fill_failed", "test.flaky"],
  ])("classifies %s as %s", (code, expected) => {
    const message = `turn-4-send blocked: ${code} after 3 attempt(s) composer{textarea=disabled,textLen=0,sendButton=disabled,rendered=7}`;
    expect(classifyFailure({ message, context: "turn" })).toBe(expected);
  });
});
