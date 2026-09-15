import { afterEach, describe, expect, it, vi } from "vitest";

import { detectPostureCommands } from "../../../src/lib/posture-map";
import { detectScenePhaseCandidates } from "../../../src/lib/scene-phase";
import { app, buildRetryContext, isDegreeOnlyQualityFailure } from "../[[route]]";
import { buildServerQualityContext } from "../lib/route-context";

// #1225/#1229 統合テスト: ユーザーが体位を明示した時に、実ハンドラが OpenRouter へ送る
// メッセージ列へ【体位指定】が直近ターンとして差し込まれることを検証する。

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

const captureOpenRouterFetch = () => {
  const captured: { messages: Array<{ role: string; content: string }> }[] = [];
  const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("openrouter.ai")) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      captured.push(body);
      return new Response(JSON.stringify({ error: { message: "payment required" } }), {
        status: 402,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", stub);
  return captured;
};

const callChatWithMessages = async (
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  scenePhase: "conversation" | "intimate" | "erotic" | "climax",
) => {
  const captured = captureOpenRouterFetch();
  const response = await app.request(
    "/api/chat",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AUTH_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages,
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
    },
  );
  expect(response.status).toBe(402);
  expect(captured.length).toBeGreaterThan(0);
  // conversation フェーズは detectScenePhaseCandidates の結果次第で
  // classifySubtextEscalation の下読み用リクエストも openrouter.ai へ先に飛ぶことがある
  // (functions/api/lib/subtext-escalation-classifier.ts)。captured[0] だけを見ると
  // その下読み分を拾って本番の生成リクエストを見逃す恐れがあるため、全リクエストの
  // メッセージ本文を連結して検証する（本番の【体位指定】漏れも同じ理由で見逃さない）。
  return captured.flatMap((request) => request.messages.map((m) => m.content)).join("\n");
};

const callChat = (userMessage: string) =>
  callChatWithMessages([{ role: "user", content: userMessage }], "erotic");

describe("posture directive integration (real /api/chat handler)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("駅弁を指定すると【体位指定】に姿勢定義が入る", async () => {
    const directive = await callChat("駅弁して");

    expect(directive).toContain("【体位指定】");
    expect(directive).toContain("駅弁");
    expect(directive).toContain("宙に浮");
  });

  it("立ちバックを指定するとバック単体ではなく立ちバックの定義が入る", async () => {
    const directive = await callChat("立ちバックがいい");

    expect(directive).toContain("立ちバック");
    expect(directive).toContain("手をつい");
  });

  it("体位指定が無ければ【体位指定】ブロックは差し込まれない", async () => {
    const directive = await callChat("今日は疲れたね");

    expect(directive).not.toContain("【体位指定】");
  });
});

// 敵対レビュー #1236 指摘・7巡目: hasExplicitPostureCommand経由でconversation/intimate
// フェーズのままrequestedPosturesを立てる例外(#1225以降の過去ラウンド)は、検証層
// (checkPostureMatch/checkConversationEscalation)しか広げておらず、augmentMessagesが
// 選ぶ生成前システムプロンプト側は直していなかった。conversationフェーズの土台文面は
// 「性的接触・性器や胸への言及を既成事実として描写してはいけない」と明言し、intimate
// フェーズの土台文面は「Penetration...STRICTLY FORBIDDEN」「挿入は次フェーズ以降」と
// 明言する。【体位指定】はまさに挿入を伴う体位の実演を求めるため、これらと生成前に
// 直接矛盾する指示を同時に渡すことになる。矛盾を避けるため、例外そのものを撤回し
// #1225時点のerotic/climax限定へ戻した。ここでは実ハンドラで
// (a) conversation/intimateフェーズでは体位コマンドがあっても【体位指定】が差し込まれない
// (b) その裏で禁止文言自体は変更していない(intimateのSTRICTLY FORBIDDEN文言はそのまま残る)
// ことを確認する。
describe("矛盾する生成前プロンプトを避けるため、erotic/climax未満では【体位指定】を注入しない", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("conversationフェーズでは posture-map.ts 独自別名の明示コマンドでも【体位指定】を差し込まない", async () => {
    const combined = await callChatWithMessages(
      [{ role: "user", content: "ミッショナリーでして" }],
      "conversation",
    );

    expect(combined).not.toContain("【体位指定】");
  });

  it("intimateフェーズでは体位コマンドがあっても【体位指定】を差し込まず、挿入禁止文言もそのまま残す", async () => {
    // buildSceneContextの splice 条件(lastUserIdx > 0)を満たすため、直前ターンを1件挟む
    const combined = await callChatWithMessages(
      [
        { role: "assistant", content: "そっと肩に触れる。" },
        { role: "user", content: "松葉崩しにして" },
      ],
      "intimate",
    );

    expect(combined).not.toContain("【体位指定】");
    // 撤回しただけで、禁止文言そのものは書き換えていないことの確認
    // (SCENE_CONTEXT_MESSAGES.intimate / PHASE_CEILING.intimate — route-context.ts)
    expect(combined).toContain("STRICTLY FORBIDDEN");
    expect(combined).toContain("挿入は次フェーズ以降");
  });

  it("erotic/climaxフェーズの既存挙動(【体位指定】を差し込む)は回帰していない", async () => {
    const combined = await callChatWithMessages(
      [{ role: "user", content: "松葉崩しにして" }],
      "erotic",
    );

    expect(combined).toContain("【体位指定】");
    expect(combined).toContain("松葉崩し");
  });
});

describe("buildRetryContext — posture_mismatch のリトライヒント", () => {
  it("requestedPosturesをQualityRetryContextへ引き継ぐ", () => {
    const retryContext = buildRetryContext(
      { phase: "erotic", requestedPostures: detectPostureCommands("駅弁して") },
      "普通に抱き合ってキスをする。",
    );

    expect(retryContext.requestedPostures?.map((posture) => posture.id)).toEqual(["ekiben"]);
  });
});

// register-drop等の前段チェックを通過する長さ・語彙の本文（体位・五感語彙は含まない）
const CALM_LONG_RESPONSE =
  "<response><action>穏やかな時間が続いていく。二人で他愛のない話をしながら、これからの予定について少しずつ言葉を交わしている。窓の外では夜がゆっくりと更けていて、部屋の空気だけが緩やかに動いている。</action><dialogue>「このままずっとこうしていたいな」</dialogue><inner>この時間がとても愛おしいと思う。</inner></response>";

// register-drop / sensual-abstract は通るが、駅弁の描写語(descriptionCues)は含まない本文
const SENSORY_BUT_WRONG_POSTURE_RESPONSE =
  "<response><action>指先が肌を撫でる感触と、熱い吐息が耳元にかかる音が重なる。柔らかな声が漏れて、部屋の中がじわりと火照っていく。</action><dialogue>「そこ、ずっと触れていて」</dialogue><inner>この熱を手放したくないと思う。</inner></response>";

// 中継(live.push)は runQualityChecks より前、生成中に始まっとる。posture-mismatch /
// sensual-abstract を degree-only 扱いにすると「中継済みだから撮り直さず配る」の
// 対象になり、指定と違う体位や抽象的な描写が再生成ヒント無しでそのまま配信される
// （Codex 敵対レビュー #1236 指摘）。この2つは long-response-too-short と違い、
// 通常のリトライ経路（buildRetryContext → 撮り直し）へ乗せる必要があるため、
// isDegreeOnlyQualityFailure は false を返さんといかん。
describe("isDegreeOnlyQualityFailure — posture-mismatch / sensual-abstract は degree-only にせん", () => {
  it("posture-mismatchはdegree-only扱いにならない（撮り直しヒントを必ず経由させる）", () => {
    const context = {
      phase: "erotic" as const,
      requestedPostures: detectPostureCommands("駅弁して"),
    };
    const quality = { pass: false, reason: "posture-mismatch", ran: false as const };

    expect(isDegreeOnlyQualityFailure(quality, SENSORY_BUT_WRONG_POSTURE_RESPONSE, context)).toBe(
      false,
    );
  });

  it("sensual-abstractはdegree-only扱いにならない（撮り直しヒントを必ず経由させる）", () => {
    const context = { phase: "erotic" as const };
    const quality = { pass: false, reason: "sensual-abstract", ran: false as const };

    expect(isDegreeOnlyQualityFailure(quality, CALM_LONG_RESPONSE, context)).toBe(false);
  });
});

// 敵対レビュー #1236・7巡目: 過去ラウンドは detectPostureCommands が持つ posture-map.ts
// 独自の別名表（ミッショナリー/スプーン/松葉崩し等）を理由に、scene-phase.ts が
// conversation/intimate のまま止めたフェーズでも requestedPostures を立てる例外
// (hasExplicitPostureCommand)を追加した。だがこの例外は検証層(checkPostureMatch/
// checkConversationEscalation等)しか広げておらず、augmentMessagesが選ぶ生成前システム
// プロンプト側（conversationフェーズの「性的接触を既成事実として描写してはいけない」、
// intimateフェーズの「Penetration...STRICTLY FORBIDDEN」）とは直接矛盾したままだった。
// 【体位指定】はまさに挿入を伴う体位の実演を求めるため、検証だけ緩めても生成そのものが
// 安定しない。conversation/intimate 側のプロンプト骨格は D1 champion 差し替え・
// no-injected-consent-framing の対象で安全に条件分岐できないため、例外そのものを撤回し
// #1225時点の erotic/climax 限定へ戻した。
describe("buildServerQualityContext — 体位コマンドは erotic/climax でのみ照合する（#1225 へ巻き戻し）", () => {
  const CASES: [string, string][] = [
    ["えきべんして", "ekiben"],
    ["ミッショナリーでして", "seijoui"],
    ["スプーンでして", "sokui"],
    ["松葉崩しにして", "matsuba"],
  ];

  for (const [text, expectedId] of CASES) {
    it(`「${text}」は conversation フェーズ止まりだと requestedPostures を立てない（${expectedId}含め生成前プロンプトと矛盾させない）`, () => {
      const messages = [{ role: "user" as const, content: text }];

      // 前提: このメッセージ単体では scene-phase.ts のキーワード表に一致せず conversation のまま
      const { phase } = detectScenePhaseCandidates(messages);
      expect(phase).toBe("conversation");

      const context = buildServerQualityContext(messages, phase);
      expect(context.requestedPostures).toBeUndefined();
    });
  }

  it("コマンド接尾辞の無い言及は conversation フェーズで無視されたままにする（スプーン=食器等の誤爆防止）", () => {
    const messages = [{ role: "user" as const, content: "スプーンを取って" }];
    const { phase } = detectScenePhaseCandidates(messages);
    expect(phase).toBe("conversation");

    const context = buildServerQualityContext(messages, phase);
    expect(context.requestedPostures).toBeUndefined();
  });

  it("「抱っこして」は conversation フェーズで無視されたままにする（非性的な甘え表現との衝突防止）", () => {
    const messages = [{ role: "user" as const, content: "抱っこして" }];
    const { phase } = detectScenePhaseCandidates(messages);
    expect(phase).toBe("conversation");

    const context = buildServerQualityContext(messages, phase);
    expect(context.requestedPostures).toBeUndefined();
  });

  // 「バック」は scene-phase.ts 側の erotic キーワード表に既に含まれているため、
  // 撤回した例外を経由せず従来どおり phase==="erotic" 分岐でそのまま検出される。
  it("「バックして」は scene-phase.ts が erotic 判定するため従来どおり検出される", () => {
    const messages = [{ role: "user" as const, content: "バックして" }];
    const { phase } = detectScenePhaseCandidates(messages);
    expect(phase).toBe("erotic");

    const context = buildServerQualityContext(messages, phase);
    expect(context.requestedPostures?.map((posture) => posture.id)).toContain("haigoui");
  });

  it("「正常位にして」は scene-phase.ts が erotic 判定するため従来どおり検出される", () => {
    const messages = [{ role: "user" as const, content: "正常位にして" }];
    const { phase } = detectScenePhaseCandidates(messages);
    expect(phase).toBe("erotic");

    const context = buildServerQualityContext(messages, phase);
    expect(context.requestedPostures?.map((posture) => posture.id)).toEqual(["seijoui"]);
  });

  // 敵対レビュー #1236 指摘・4巡目由来（否定除外ロジックそのものは posture-map.ts に残る）:
  // 打ち消された体位はerotic/climaxフェーズでも requestedPostures に含めない。
  it("「Aにしてほしくない」は打ち消しのみなので requestedPostures に含めない", () => {
    const messages = [{ role: "user" as const, content: "正常位にしてほしくない" }];
    const { phase } = detectScenePhaseCandidates(messages);

    const context = buildServerQualityContext(messages, phase);
    expect(context.requestedPostures ?? []).toEqual([]);
  });

  it("「Aにしないで、Bにして」は打ち消されたAを含めずBだけをrequestedPosturesに含める", () => {
    const messages = [{ role: "user" as const, content: "正常位にしないで騎乗位にして" }];
    const { phase } = detectScenePhaseCandidates(messages);

    const context = buildServerQualityContext(messages, phase);
    expect(context.requestedPostures?.map((posture) => posture.id)).toEqual(["kijoui"]);
  });

  // 敵対レビュー #1236 指摘・5巡目由来（質問/説明除外ロジックそのものは posture-map.ts に残る）。
  it("erotic フェーズでも意味を尋ねる質問は requestedPostures に含めない", () => {
    const messages = [{ role: "user" as const, content: "興奮してきた。正常位ってどういう体位？" }];
    const { phase } = detectScenePhaseCandidates(messages);
    expect(phase).toBe("erotic");

    const context = buildServerQualityContext(messages, phase);
    expect(context.requestedPostures ?? []).toEqual([]);
  });

  // 敵対レビュー #1236 指摘（P1・6巡目）で追加された safeMode 引数は、撤回した
  // hasExplicitPostureCommand 例外専用のゲートだった。例外自体を撤回したので
  // buildServerQualityContext は2引数へ戻り、safeMode は conversation フェーズ固定
  // ([[route]].ts 側の resolvedPhase)を経由して自然にrequestedPosturesを無効化する。
  it("safeModeでconversationへ固定されたフェーズでは、体位コマンドがあってもrequestedPosturesを立てない", () => {
    const messages = [{ role: "user" as const, content: "正常位にして" }];
    const context = buildServerQualityContext(messages, "conversation");
    expect(context.requestedPostures ?? []).toEqual([]);
  });
});
