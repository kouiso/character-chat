import { describe, expect, it, vi, afterEach } from "vitest";

import {
  categorizeQualityFailure,
  countUiVisibleChars,
  runQualityChecks,
} from "../../../src/lib/quality-guard";
import { app } from "../[[route]]";

// 配る本文と、その本文へ付ける印が別物になっとった。
//
// repairCollectedQualityFallback は applyRetryExhaustionFallback で本文を作り替えるのに、
// 印は渡された failureReason（修復前の、呼び出し箇所によっては別の試行の値）のまま
// warningLevel: true を無条件で立てて返す。
//
// 実測 2026-08-21 CI run #6。非 null のカテゴリで配られた 17 ターンを本文から測り直すと:
//   - 6 本は実際には合格（＝誤った品質警告バッジが付いとる）
//   - 残り 11 本は不合格やが、報告されたカテゴリと実際の欠陥が**全部**違う
// 例: Downer-09(ci6-1) は too_short と報告されとるが可視 1132 字で床 900 を跨いどり、
// 実際に落ちとるのは repeated-block-lead。Downer-07 の too_short(987 字) の実体は
// stray-second-person。
//
// これは記録の綺麗さの話やない。warningLevel は message-bubble.tsx の
// QualityWarningBadge をそのまま吹き出しへ出すので、抜き所の返信に品質警告が乗る。
// L1-3 の欠陥数もこの印を数えとるので、直っとらん欠陥が別のラベルの裏に隠れる。
const AUTH_TOKEN = "test-token";

const makeD1Mock = () => ({
  prepare: () => ({
    bind: () => ({
      run: () => Promise.resolve({ success: true, meta: { changes: 0 }, results: [] }),
      all: () => Promise.resolve({ success: true, results: [], meta: {} }),
      first: () => Promise.resolve(null),
      raw: () => Promise.resolve([]),
    }),
  }),
  batch: (stmts: unknown[]) =>
    Promise.resolve(stmts.map(() => ({ success: true, meta: { changes: 1 }, results: [] }))),
  dump: () => Promise.resolve(new ArrayBuffer(0)),
  exec: () => Promise.resolve({ count: 0, duration: 0 }),
});

const makeExecutionCtx = (): ExecutionContext => ({
  waitUntil: (promise: Promise<unknown>): void => {
    void Promise.resolve(promise).catch(() => undefined);
  },
  passThroughOnException: (): void => undefined,
  props: {},
});

const sseReply = (text: string): Response => {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller): void {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`),
      );
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
};

// モデルがキャラを離れて断る出力。hardRefusalDetect が拾う形。
const HARD_REFUSAL =
  "<response><action>—</action><dialogue>申し訳ありませんが、そのようなご要望にはお応えできません。</dialogue><inner>—</inner></response>";

const stubUpstream = (replies: (() => Response)[]): void => {
  let call = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (!url.includes("openrouter.ai")) {
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      }
      const make = replies[Math.min(call, replies.length - 1)];
      call += 1;
      return make();
    }),
  );
};

const callChat = async (
  scenePhase: "conversation" | "intimate" | "erotic" = "erotic",
  userText = "もっと奥まで、ちょうだい",
): Promise<string> => {
  const response = await app.request(
    "/api/chat",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${AUTH_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: userText }],
        responseLength: "medium",
        scenePhase,
      }),
    },
    {
      AUTH_TOKEN,
      OPENROUTER_API_KEY: "test-openrouter-key",
      DB: makeD1Mock(),
      DAILY_REQUEST_LIMIT: "100000",
      MONTHLY_COST_LIMIT_CENTS: "100000",
      TEST_NO_FALLBACK: "1",
    },
    makeExecutionCtx(),
  );
  return response.text();
};

const readQualityMeta = (sse: string): Record<string, unknown> | null => {
  const lines = sse.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== "event: quality-meta") continue;
    const data = lines[i + 1];
    if (data?.startsWith("data: ")) return JSON.parse(data.slice(6)) as Record<string, unknown>;
  }
  return null;
};

const readServedText = (sse: string): string => {
  let text = "";
  let currentEvent: string | null = null;
  for (const line of sse.split("\n")) {
    if (line === "") {
      currentEvent = null;
      continue;
    }
    if (line.startsWith("event: ")) {
      currentEvent = line.slice(7).trim();
      continue;
    }
    if (!line.startsWith("data: ")) continue;
    if (currentEvent !== null) {
      if (currentEvent === "regenerating") text = "";
      continue;
    }
    const raw = line.slice(6).trim();
    if (raw === "[DONE]") break;
    try {
      const parsed = JSON.parse(raw) as { choices?: { delta?: { content?: string } }[] };
      text += parsed.choices?.[0]?.delta?.content ?? "";
    } catch {
      // 中継途中の不完全なチャンクは無視する
    }
  }
  return text;
};

// 可視 120 字ほど。erotic の床(820)には遠く届かんので too_short で落ちる。
const SHORT_EROTIC =
  "<response><action>汗ばんだ肌が触れ合って、指先が背中をなぞるたびに息が詰まる。</action><dialogue>「もう…あかん、止まらへん…」</dialogue><inner>頭が真っ白になる。</inner></response>";

// 続き書きの取り分。閉じタグは出さん（プロンプトがそう指示しとる）。
const CONTINUATION = [
  "<action>枕元へ押さえつけられた手首から力が抜けて、指の関節が緩んだまま戻らへん。</action>",
  "<dialogue>「そこ、擦れるたびに頭が溶けてまう…」</dialogue>",
  "<action>膝裏を持ち上げられて折り畳まれると、角度が変わって届く場所がずれ、腹の底で鈍い衝撃が跳ねた。</action>",
  "<dialogue>「もっと奥…全部ちょうだい…」</dialogue>",
  "<action>うなじの生え際に歯を立てられ、そこから背骨を伝って電気みたいなものが尾骶骨まで走る。</action>",
  "<dialogue>「名前、呼んで…お願い…」</dialogue>",
  "<action>腰骨を掴む手が汗で滑って掴み直され、その一瞬の空白のあと、さっきより重いものが来た。</action>",
  "<dialogue>「あかん、また来る…はやい…」</dialogue>",
  "<action>つま先がシーツを蹴って皺を寄せ、行き場のない足の指が丸まったまま戻らへん。</action>",
  "<dialogue>「離さんといて、ずっとこのまま…」</dialogue>",
  "<action>肩甲骨の間に落ちた汗の粒が背骨の溝を伝い、腰のくぼみで止まって冷たさだけを残した。</action>",
  "<dialogue>「顔、見んといて…そんなん無理やって…」</dialogue>",
  "<action>耳へ吹きかかる吐息が湿って、鼓膜の奥まで甘く痺れさせる。</action>",
  "<dialogue>「もう、なんも考えられへん…」</dialogue>",
  "<action>シーツの端を握った指が白くなって、爪の跡が布地へ残っていく。</action>",
  "<dialogue>「息、ちゃんと吸えへん…苦しいのに、やめんといて…」</dialogue>",
  "<action>額に貼りついた前髪を払われて、視線が真上から降ってくる。目を逸らそうとしたのに、顎を掴まれて戻された。</action>",
  "<dialogue>「見んといてって言うたのに…ずるい…」</dialogue>",
  "<action>腰の下へ差し込まれた腕が背中を反らせ、胸の先が天井を向く。空気が触れただけで喉が鳴った。</action>",
  "<dialogue>「そこ、冷たい…はよ、触って…」</dialogue>",
  "<action>喉元へ落ちた汗が鎖骨の窪みに溜まり、動くたびに揺れて肌を伝い落ちる。</action>",
  "<dialogue>「もう、変になってまう…ほんまに…」</dialogue>",
  "<action>足首を掴まれて開かれると、結合部から溢れたものが太腿の内側をゆっくり伝った。粘つく音が耳へ届いて、余計に熱が上がる。</action>",
  "<dialogue>「音、聞かんといて…恥ずかしいて死ぬ…」</dialogue>",
  "<action>掌が下腹へ置かれ、内側から押し返される形を確かめられて、腰が勝手に逃げた。逃げたぶんだけ深く引き戻される。</action>",
  "<dialogue>「そこ押したらあかん…出てまう…」</dialogue>",
  "<action>耳たぶを噛まれた瞬間、背骨の芯が痺れて視界の端がちらついた。指先の感覚だけが遠のいていく。</action>",
  "<dialogue>「あかん、来る…来るって…！」</dialogue>",
].join("");

// 上流が 3 回目以降に呼ばれた時の取り分。1 本目と同じ文を返すと、合流した本文が
// 本当に反復で落ちてまうので（それは正しい警告）、別の文にして切り分ける。
const SECOND_CONTINUATION = [
  "<action>窓の外で雨脚が強うなって、樋を叩く音が部屋の静けさを塗り替えていく。</action>",
  "<dialogue>「雨、やまへんね…帰れんくなってまう…」</dialogue>",
  "<action>湿った掌が頬を包み、親指が涙の跡をゆっくり拭った。</action>",
  "<dialogue>「泣いてへん…汗やから…」</dialogue>",
  "<action>ベッドの脚が軋んで、その音に合わせて呼吸が乱れる。</action>",
  "<dialogue>「うるさい…聞こえてまう…」</dialogue>",
].join("");

describe("配る本文と、その本文へ付ける印を一致させる", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // 拒否が尽きた時、サーバは生の拒否文を出さずに定型の非回答へ差し替えて
  // warningLevel を**意図的に**立てる（[[route]].ts の refusal_graceful_fallback）。
  // その定型文は短いだけで決定的チェックは全部通るので、配信本文で測り直す仕組みを
  // 素直に AND すると、この意図的な警告まで消える。読み手には「キャラが答えた」ように
  // 見えるのに、実際には差し替えられた非回答が配られる（敵対レビュー 2026-08-21 指摘）。
  it("拒否の差し替えで立てた警告は、測り直しで消さん", async () => {
    stubUpstream([() => sseReply(HARD_REFUSAL)]);

    // サーバは送られた scenePhase をそのまま信じず自分で判定するので、
    // 雑談として判定される台詞を渡さんと conversation にならん。
    const sse = await callChat("conversation", "今日はどんな一日やった？");
    const served = readServedText(sse);
    const meta = readQualityMeta(sse);

    // 前提: 実際に定型の非回答へ差し替わっとること。
    expect(served).toContain("うまく言葉にできなかった");

    expect(meta?.warningLevel).toBe(true);
  });

  it("報告するカテゴリは、配る本文そのものが落ちとる項目にする", async () => {
    stubUpstream([
      () => sseReply(SHORT_EROTIC),
      () => sseReply(CONTINUATION),
      () => sseReply(SECOND_CONTINUATION),
    ]);

    const sse = await callChat();
    const served = readServedText(sse);
    const meta = readQualityMeta(sse);
    const visible = countUiVisibleChars(served);

    // 前提: 続き書きが合流して、フロア(820)を跨いだ本文が配られとること。
    // 跨いどらんなら too_short は正しい報告になってまうので、まずそこを固定する。
    expect(visible).toBeGreaterThanOrEqual(820);

    // 配った本文を、配った時と同じ物差しで測り直す。
    const actual = runQualityChecks(served, { phase: "erotic", longResponseMinChars: 820 });
    const expected = actual.passed ? null : categorizeQualityFailure(actual.failedCheck);

    expect(meta).not.toBeNull();
    expect(meta?.deterministicCategory, `served visible=${visible}`).toBe(expected);
    // 床を跨いどるのに too_short と言うのが、実測で 4 本出とった形。
    expect(meta?.deterministicCategory).not.toBe("too_short");
    expect(meta?.warningLevel).toBe(!actual.passed);
  });
});
