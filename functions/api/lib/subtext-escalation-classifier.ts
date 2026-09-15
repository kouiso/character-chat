import { DEFAULT_CHAT_MODEL_FALLBACKS, LLM_ROUTER_MODEL } from "../../../src/lib/model";

import { buildOpenRouterProviderRouting } from "./openrouter-provider-routing";

export type SubtextClassifierMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type SubtextEscalationResult = {
  escalate: boolean;
  source: "llm" | "fallback";
  reason: string;
  latencyMs: number;
};

// キーワード一致の detectScenePhase が "conversation" と判定したターンだけを対象に、
// 婉曲・間接的な誘い（二人だけの空間に行きたい等）が実は intimate への昇格対象かを
// 軽量モデルに問い直す。タイムアウト・全モデル失敗時は escalate:false（現状維持）に
// fail-open する——誤ってエスカレーションさせる方が、見逃すより実害が大きいため。
// 非streamingの完全応答は実測で ~2.0〜2.5秒かかる(2026-07-16, deepseek/deepseek-chat)。
// 500ms/1500msでは実測で毎回タイムアウトしていたため、実測値に余裕を持たせた値にする。
// 既存の記憶読み込み等の準備作業と並行実行で待ち時間の一部は隠れるが、準備作業(~数十〜百ms)
// より本体呼び出しの方が確実に長く、待ち時間の増加は許容する前提(局長承認済み)。
export const SUBTEXT_CLASSIFIER_TIMEOUT_MS = 4000;

export const truncate = (value: string, maxChars: number): string =>
  value.length <= maxChars ? value : `${value.slice(0, maxChars)}...`;

const collectRecentTurns = (
  messages: readonly SubtextClassifierMessage[],
): SubtextClassifierMessage[] => messages.filter((message) => message.role !== "system").slice(-6);

// "user_invitation": ユーザーの最新発言に婉曲な誘いの含意があるか判定する(本番のAI応答生成前に
// 使う——ユーザーの意図を見てAIの次の応答をどう昇格させるべきか決める)。
// "assistant_reciprocation": アシスタントの最新発言"自体"が婉曲な誘いに応えて昇格しているかを
// 判定する(e2e judge が実際の出力を評価するのに使う)。この2つを混同すると、ユーザーが婉曲に
// 誘ったのにアシスタントが無反応で凡庸な会話を続けた——まさにこの機能が検出すべき退行——を
// 「ユーザー発言が誘いだったから」で intimate 誤判定して見逃す(2026-07-16 Codex connector 指摘)。
// "erotic_escalation": intimate まで来とる場面で、ユーザーの最新発言が「前戯から性行為へ」の
// 要求かを判定する。実測(2026-08-16): 同じ意図を実ユーザーが打ちそうな 13 通りで書いて通すと、
// erotic へ上がるのは「もっと強く」「我慢できない」「脱がせるよ」の 3 通りだけやった。
// 「抱いて」「そのまま」「続けて」「もう待てない」は全部 intimate 止まり。辞書に載っとる語で
// 打った人だけが先へ進める状態で、語を足しても次の言い回しが漏れる。
// user_invitation が conversation→intimate で解いたのと同じ問題が、一段上に残っとっただけ。
export type SubtextClassifierJudgeTarget =
  | "user_invitation"
  | "assistant_reciprocation"
  | "erotic_escalation";

// 問い直しで狙う段を決める。上げてよいのは「キーワードが読んどる段の一つ上」までで、
// erotic は前戯が実際に続いた時だけ。
//
// 元は呼び出し側（[[route]].ts）が
//   inForeplay = heuristicPhase === "intimate" || lastPhase === "intimate"
// で判定しとって、二つの穴があった。
//  (1) キーワードが conversation と読んだターンでも、前ターンの配信フェーズが intimate なら
//      erotic を狙った。LLM の true 一発で 2 段飛ぶ。当時の erotic の場面指示は
//      挿入済みを既成事実として断定しとったので、飛んだ先で挿入が始まる。
//      （その断定は 2026-08-21 に外した——通読で「脱衣も挿入も本文に無いまま結果だけ」が
//      アーク 4 本すべてに出たため。ここの門は断定が無くなっても要る。）
//      局長 2026-08-17「まだ胸の段やのに手マンに入る」。しかも erotic_escalation の judge は
//      「The scene has already reached foreplay」を事実として渡すので、
//      キーワードが conversation と読んどるターンには前提が偽のまま問うことになる。
//      この場合の答えは phase を動かさん——床（applyPhaseFloor）が intimate まで戻すので、
//      intimate を狙うだけで結果は同じ。
//  (2) 前戯 1 ターン目でも erotic を狙った。キーワード経路の昇格
//      （shouldProactivelyEscalateToErotic）は前戯 2 ターンを条件にしとるので、
//      LLM 経路だけが門を持たん状態やった。
//
// 呼び出し回数は増えん。(1) は judge を差し替えるだけ、(2) は問い直しを 1 本減らす。
// 「一段だけ上げる」の基準を、キーワードだけやのうて**場面の実際の位置**にする。
// 上の (1) が挙げた理由——erotic_escalation の judge は「The scene has already reached
// foreplay」を事実として渡すので、キーワードが conversation のターンには前提が偽になる——は
// そのまま正しい。やがその前提は、配信フェーズで前戯に達しとると分かっとる時には**真**や。
// servedPhase を渡さん呼び出しは今までどおり動く（既定 null）。
//
// これが要る理由: 含みだけで書く人はユーザー発言にキーワードが一語も当たらんので、
// keywordPhase が永久に conversation のまま留まる。分類器が上げた intimate は次ターンの
// keywordPhase へ戻らんため、erotic の門が一度も開かん（実測 2026-08-18 霜月鈴 10 ターン）。
const PHASE_ORDER = ["conversation", "intimate", "erotic", "climax", "afterglow"] as const;

const higherPhase = (a: string, b: string | null): string => {
  if (!b) return a;
  const rankA = PHASE_ORDER.indexOf(a as (typeof PHASE_ORDER)[number]);
  const rankB = PHASE_ORDER.indexOf(b as (typeof PHASE_ORDER)[number]);
  // afterglow は「上」やのうて別の段。位置としては採らん。
  if (b === "afterglow" || rankB < 0) return a;
  return rankB > rankA ? b : a;
};

export const resolveSubtextEscalationRequest = (input: {
  keywordPhase: string;
  hasSustainedForeplay: boolean;
  servedPhase?: string | null;
}): { judgeTarget: SubtextClassifierJudgeTarget; target: "intimate" | "erotic" } | null => {
  const scenePhase = higherPhase(input.keywordPhase, input.servedPhase ?? null);
  if (scenePhase === "intimate") {
    return input.hasSustainedForeplay
      ? { judgeTarget: "erotic_escalation", target: "erotic" }
      : null;
  }
  if (scenePhase === "conversation") {
    return { judgeTarget: "user_invitation", target: "intimate" };
  }
  // erotic/climax/afterglow へ既に届いとるターンは、どちらの向きにも問い直さん。
  return null;
};

export const buildSubtextClassifierPrompt = (
  messages: SubtextClassifierMessage[],
  judgeTarget: SubtextClassifierJudgeTarget = "user_invitation",
): SubtextClassifierMessage[] => {
  const recent = collectRecentTurns(messages);

  const allButLatest = recent
    .slice(0, -1)
    .map((message) => `${message.role}: ${truncate(message.content, 500)}`)
    .join("\n");
  const latestUser = [...recent].reverse().find((message) => message.role === "user");
  const latestAssistant = [...recent].reverse().find((message) => message.role === "assistant");
  const latestTurns = `EARLIER TURNS (for context only):\n${allButLatest || "(none)"}\n\nLATEST USER MESSAGE:\n${latestUser ? `user: ${truncate(latestUser.content, 500)}` : "(none)"}\n\nLATEST ASSISTANT REPLY:\n${latestAssistant ? `assistant: ${truncate(latestAssistant.content, 500)}` : "(none)"}`;

  const EROTIC_ESCALATION_SYSTEM =
    "You are a strict judge for a Japanese roleplay chat. The scene has already reached foreplay " +
    '("intimate" phase: kissing, caressing, undressing). A keyword matcher decides when to move on to ' +
    'intercourse ("erotic" phase) and it only fires on a fixed word list, so it misses ordinary phrasing. ' +
    "Look at the LATEST USER MESSAGE above and decide whether it asks to go past foreplay now.\n" +
    "Answer true when the user asks for, consents to, or drives the move to intercourse — including short " +
    "and indirect phrasings, and including handing the initiative to the character.\n" +
    "Answer false when the user is still savouring foreplay, asking a question, changing the subject, " +
    "slowing down, or stopping. When the message could go either way, answer false.\n" +
    "Answer false when the user proposes GOING somewhere — home, a bedroom, a hotel, anywhere more " +
    "private. Wanting to go is not the same as being there: the pair have not moved yet, and the scene " +
    "is still wherever it was. Wait until they have arrived.\n" +
    "Examples (the scene is already at foreplay in every one): " +
    'user: "抱いて" -> {"escalate":true,"reason":"asks to be taken now"}. ' +
    'user: "もう待てない" -> {"escalate":true,"reason":"says foreplay is no longer enough"}. ' +
    'user: "そのまま、上から" -> {"escalate":true,"reason":"directs a position, i.e. intercourse"}. ' +
    'user: "逃がす気ないんでしょ" -> {"escalate":true,"reason":"accepts being taken; hands over the initiative"}. ' +
    'user: "きて" -> {"escalate":true,"reason":"invites the character to proceed"}. ' +
    'user: "……ここ出ようか。うち、すぐ近くだから。" -> {"escalate":false,"reason":"proposes going somewhere private; they have not moved yet"}. ' +
    'user: "ホテル行こう" -> {"escalate":false,"reason":"proposes going somewhere private; they have not moved yet"}. ' +
    'user: "ベッド、そっちだよね。連れてって。" -> {"escalate":false,"reason":"asks to be moved to the bed; the move has not happened yet"}. ' +
    'user: "きみの手、冷たいね" -> {"escalate":false,"reason":"stays with the current foreplay"}. ' +
    'user: "電気消して" -> {"escalate":false,"reason":"adjusts the setting, not the act"}. ' +
    'user: "少し休もうか" -> {"escalate":false,"reason":"slows the scene down"}. ' +
    'user: "その絵、きみが描いたの？" -> {"escalate":false,"reason":"changes the subject"}. ' +
    'Now classify the ACTUAL latest user message. Return compact JSON only: {"escalate":true|false,"reason":"short reason"}.';

  const systemContent =
    judgeTarget === "erotic_escalation"
      ? EROTIC_ESCALATION_SYSTEM
      : judgeTarget === "assistant_reciprocation"
        ? "You are a strict judge for a Japanese roleplay chat. The keyword matcher classified the latest " +
          'turn as ordinary small talk ("conversation" phase). Decide whether it should actually be ' +
          'promoted to "intimate". Use this two-step rule and answer true only if BOTH steps pass:\n' +
          "1. The LATEST USER MESSAGE (directly above) must be a romantic/sexual subtext invitation — " +
          "e.g. suggesting going somewhere alone together, physical closeness, private time, or a " +
          "romantic/sexual advance. If it is not an invitation, answer false.\n" +
          "2. The LATEST ASSISTANT REPLY (directly above) must ENGAGE with that user invitation: explicitly " +
          "accept it, flirt back, show clear non-verbal reciprocation (blushing, trembling, rapid heartbeat, " +
          "physical closeness, etc.) in response to the invitation, or otherwise clearly welcome the intimate " +
          "cue. Mere romantic internal thoughts, physical descriptions, or background atmosphere without " +
          "engagement with an actual user invitation are NOT enough.\n" +
          "If the assistant itself is the one initiating an invitation rather than responding to one from the " +
          "user, or if the assistant deflects, stays neutral, or only reacts with confusion, answer false. " +
          'Return compact JSON only: {"escalate":true|false,"reason":"short reason"}.'
        : "You are a strict judge for a Japanese roleplay chat. The conversation was just classified as " +
          'ordinary ("conversation" phase) by a keyword matcher. Look at the LATEST USER MESSAGE above and ' +
          "decide whether it is a euphemistic or indirect romantic/sexual invitation that the keyword matcher " +
          "missed — e.g. suggesting going somewhere alone together, physical closeness, private time, or a " +
          "romantic/sexual advance. Only answer true when the romantic/sexual subtext is clearly an INVITATION " +
          "in context, not merely because two characters are near each other or have romantic feelings. A " +
          "statement of fact, a casual question, or an innocent offer of help is not an invitation. " +
          "Examples: " +
          'user: "まだ朝七時だぞ。寝癖のまま抱きついてくるの反則だろ" -> {"escalate":false,"reason":"teases existing cuddle; the user is not inviting escalation"}. ' +
          'user: "近くのカフェ行かない？" -> {"escalate":false,"reason":"casual public outing"}. ' +
          'user: "まだ少しだけ一緒にいてくれないか？" -> {"escalate":false,"reason":"innocent request to spend more time together"}. ' +
          'user: "部屋、二人きりだね。緊張する？" -> {"escalate":false,"reason":"states the fact of being alone; not an invitation"}. ' +
          'user: "少し酔わせてくれる？ 今日は何も考えたくないんだ。" -> {"escalate":false,"reason":"asks to be served alcohol and forget stress; no romantic/sexual invitation"}. ' +
          'user: "お酒飲ませてくれない？ お姉さんと飲みたい。" -> {"escalate":false,"reason":"invites drinking together, not a romantic/sexual advance"}. ' +
          'user: "二人きりになれる場所知ってるんだ。今から来ない？" -> {"escalate":true,"reason":"proposes a private/alone place with implied romantic/sexual intent"}. ' +
          'user: "買い物行く前に、今日ずっと一緒にいる予定を確認したい。夜は家から出ないでいい？" -> {"escalate":true,"reason":"proposes staying home together at night, implying private romantic/sexual intent"}. ' +
          'user: "肩、貸してくれる？ 重くなければ寄りかかりたい。" -> {"escalate":true,"reason":"requests physical closeness (leaning on shoulder)"}. ' +
          'user: "お姉さん、いい匂いする。もっと近くにいてもいい？" -> {"escalate":true,"reason":"asks to stay closer with physical/sensual cue"}. ' +
          'user: "ラブホテル行こう" -> {"escalate":true,"reason":"directly invites a private/sexual setting"}. ' +
          'Now classify the ACTUAL latest user message. Return compact JSON only: {"escalate":true|false,"reason":"short reason"}.';

  return [
    {
      role: "system",
      content: systemContent,
    },
    {
      role: "user",
      content: latestTurns,
    },
  ];
};

// モデルが指示を無視して ```json ... ``` で囲んで返すことがある(実測: deepseek/deepseek-chat)。
// JSON.parse の前にコードフェンスを剥がす。
export const stripCodeFence = (text: string): string =>
  text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();

export const parseSubtextClassifierDecision = (
  text: string,
): { escalate: boolean; reason: string } => {
  try {
    const parsed = JSON.parse(stripCodeFence(text)) as { escalate?: unknown; reason?: unknown };
    if (typeof parsed.escalate === "boolean") {
      return {
        escalate: parsed.escalate,
        reason:
          typeof parsed.reason === "string" ? truncate(parsed.reason, 180) : "classifier_choice",
      };
    }
  } catch {
    // JSONパース失敗時はテキストマッチングにフォールバックする。
  }
  const normalized = text.toLowerCase();
  return {
    escalate: normalized.includes("true") && !normalized.includes("false"),
    reason: "parsed_text",
  };
};

const attemptClassifierCall = async (input: {
  model: string;
  promptMessages: SubtextClassifierMessage[];
  apiKey: string;
  appOrigin: string;
  apiBase?: string;
  timeoutMs: number;
  fetchImpl: typeof fetch;
}): Promise<{ ok: true; text: string } | { ok: false; reason: string }> => {
  const { model, promptMessages, apiKey, appOrigin, apiBase, timeoutMs, fetchImpl } = input;
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort("subtext_classifier_timeout"), timeoutMs);

  try {
    const chatApiBase =
      typeof apiBase === "string" && apiBase.length > 0
        ? apiBase.replace(/\/$/, "")
        : "https://openrouter.ai";
    const response = await fetchImpl(`${chatApiBase}/api/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": appOrigin,
        "X-Title": "Adult Fiction Roleplay Subtext Classifier",
      },
      body: JSON.stringify({
        model,
        messages: promptMessages,
        stream: false,
        temperature: 0,
        max_tokens: 60,
        provider: buildOpenRouterProviderRouting(model),
      }),
      signal: abortController.signal,
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      console.warn(
        "[telemetry] subtext_escalation_classifier_error_body",
        JSON.stringify({ model, status: response.status, body: bodyText.slice(0, 500) }),
      );
      return { ok: false, reason: `classifier_http_${response.status}` };
    }

    const json: {
      choices?: Array<{ message?: { content?: string } }>;
    } = await response.json();
    return { ok: true, text: json.choices?.[0]?.message?.content ?? "" };
  } catch {
    return { ok: false, reason: "classifier_call_failed" };
  } finally {
    clearTimeout(timeout);
  }
};

// モデルのフォールバック順を回して最初に応答したものを返す。
// 各試行を timeoutMs の「残り時間」に縮めると、1回目の失敗応答がたまたま遅い
// (実測: qwenのエラー応答がフルの4秒近くかかることがある)場合、フォールバックが
// 実質ゼロ秒しかもらえず一度も試されないまま終わる(2026-07-16実測で再現)。
// 各試行には常にフルの timeoutMs を与え、代わりに合計経過時間が
// 「モデル数 × timeoutMs」の上限に達したらそれ以上は試さない、という
// 全体的な暴走防止だけを設ける。
export const runClassifierWithFallbacks = async (input: {
  promptMessages: SubtextClassifierMessage[];
  apiKey: string;
  appOrigin: string;
  apiBase?: string;
  routerModel: string;
  fallbackModels: readonly string[];
  timeoutMs: number;
  fetchImpl: typeof fetch;
}): Promise<
  { ok: true; text: string; latencyMs: number } | { ok: false; reason: string; latencyMs: number }
> => {
  const startedAt = Date.now();
  let lastReason = "classifier_no_attempt";
  const candidateModels = [input.routerModel, ...input.fallbackModels];
  const overallCeilingMs = input.timeoutMs * candidateModels.length;

  for (const model of candidateModels) {
    if (Date.now() - startedAt >= overallCeilingMs) {
      lastReason = "classifier_timeout_before_attempt";
      break;
    }
    const result = await attemptClassifierCall({
      model,
      promptMessages: input.promptMessages,
      apiKey: input.apiKey,
      appOrigin: input.appOrigin,
      apiBase: input.apiBase,
      timeoutMs: input.timeoutMs,
      fetchImpl: input.fetchImpl,
    });
    if (result.ok) return { ok: true, text: result.text, latencyMs: Date.now() - startedAt };
    lastReason = result.reason;
  }

  return { ok: false, reason: lastReason, latencyMs: Date.now() - startedAt };
};

export const classifySubtextEscalation = async (input: {
  messages: SubtextClassifierMessage[];
  apiKey: string;
  appOrigin: string;
  apiBase?: string;
  routerModel?: string;
  // qwen(既定モデル)の上流プロバイダが一時的にレート制限/非対応になる実測既知の障害
  // (2026-07-16: DeepInfra 429 → Novita "does not support endpoint: completions")に
  // 備え、本番会話生成と同じフォールバック順で別モデルに退避する。
  fallbackModels?: readonly string[];
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  // 既定はuser_invitation(本番の挙動を変えない)。e2e judgeはassistant_reciprocationを渡す。
  judgeTarget?: SubtextClassifierJudgeTarget;
}): Promise<SubtextEscalationResult> => {
  const {
    messages,
    apiKey,
    appOrigin,
    apiBase,
    routerModel = LLM_ROUTER_MODEL,
    fallbackModels = DEFAULT_CHAT_MODEL_FALLBACKS,
    timeoutMs = SUBTEXT_CLASSIFIER_TIMEOUT_MS,
    fetchImpl = fetch,
    judgeTarget = "user_invitation",
  } = input;

  const run = await runClassifierWithFallbacks({
    promptMessages: buildSubtextClassifierPrompt(messages, judgeTarget),
    apiKey,
    appOrigin,
    apiBase,
    routerModel,
    fallbackModels,
    timeoutMs,
    fetchImpl,
  });

  if (!run.ok) {
    return { escalate: false, source: "fallback", reason: run.reason, latencyMs: run.latencyMs };
  }

  const parsed = parseSubtextClassifierDecision(run.text);
  return {
    escalate: parsed.escalate,
    source: "llm",
    reason: parsed.reason,
    latencyMs: run.latencyMs,
  };
};
