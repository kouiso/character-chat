import { EROTIC_CHAT_MODEL } from "../../../src/lib/model";
import { stripXmlTags } from "../../../src/lib/xml-response-parser";

import { buildOpenRouterProviderRouting } from "./openrouter-provider-routing";
import {
  escapeNameForPromptQuote,
  sanitizeUserContext,
  sanitizeUserPersonaFreeText,
} from "./sanitize-injection";

import type { ScenePhase } from "../../../src/lib/scene-phase";

export type ReplySuggestionTurn = { role: "user" | "assistant"; content: string };

export type ReplySuggestionPersona = {
  name?: string | null;
  gender?: string | null;
  personality?: string | null;
};

export type ReplySuggestionContext = {
  characterName: string;
  /** キャラシート本文（character.system_prompt）。長いので頭だけ渡す */
  characterSheet: string;
  persona: ReplySuggestionPersona | null;
  scenePhase: ScenePhase | null;
  /** 古い→新しい順。最後がキャラの発言なら、それへの返事の候補を作る */
  turns: ReplySuggestionTurn[];
  /** 履歴にキャラの発言が無い（会話1手目）ときの、キャラの第一声 */
  greeting?: string | null;
};

// エロ場面でも候補をぼかさず具体的に書けるモデルが要る。チャット本線が erotic/climax で
// 使っとる deepseek をそのまま使う。候補3件は 100 トークン程度の JSON なので単価は最小。
export const REPLY_SUGGESTION_MODEL = EROTIC_CHAT_MODEL;
// 入力欄の横で待たせる UI なので、チャット本線(数十秒)より短く切る。実測の非streaming
// 完全応答は同モデルで ~2.0〜2.5 秒（subtext classifier の実測値と同経路）。
export const REPLY_SUGGESTION_TIMEOUT_MS = 8_000;
export const REPLY_SUGGESTION_COUNT = 3;
export const REPLY_SUGGESTION_MAX_TOKENS = 320;
// 履歴は「直前の一手に返す」ための最小限。ここを増やすとトークンが伸びるだけで、
// 次に何を言うかの判断材料は増えん。
export const REPLY_SUGGESTION_HISTORY_TURNS = 8;
export const REPLY_SUGGESTION_TURN_MAX_CHARS = 400;
export const REPLY_SUGGESTION_SHEET_MAX_CHARS = 1_200;
export const REPLY_SUGGESTION_ACT_MAX_CHARS = 16;
// 局長の見せた参考挙動は「（短いト書き）一行の台詞」で 20〜60 字。プロンプトでは 20〜60 と
// 頼むが、判定は少し広く取る。62 字を落とすと 3 件揃わず 503 になる方が実害が大きい。
export const REPLY_SUGGESTION_MIN_CHARS = 16;
export const REPLY_SUGGESTION_MAX_CHARS = 72;
// これ以上一致したら、キャラの発言をそのまま写しとる（= 彼女の声）と見る。
const CHARACTER_ECHO_MIN_CHARS = 8;

// プレイヤー本人を指すラベル。モデルが台詞へ話者ラベルを付けてきた時、
// プレイヤー側のものなら剥がして採用、それ以外は「彼女の台詞」として落とす。
const PLAYER_LABEL_ALIASES = ["user", "player", "あなた", "自分", "私", "わたし", "俺", "僕"];

const PROMPT_SPEAKER_FALLBACK = "あなた";

export const REPLY_SUGGESTION_SYSTEM_PROMPT = [
  "あなたは成人向けロールプレイチャットの入力補助。作るのは【プレイヤーが次に送る発言の候補】だけ。",
  "プレイヤーは人間の側。候補はプレイヤーの声で書き、相手キャラへ向けて話しかける形にする。",
  "相手キャラの台詞・内心・地の文は書かん。相手の返事を先に書くのも、話者名やラベルを付けるのもせん。",
  "候補は3件。1件は「プレイヤー自身の短い動作」と「プレイヤーが相手へ言う一行の台詞」の組にする。",
  "3件は狙いを散らす。直前のやりとりから自然に伸びる別方向を3つ、場面を見て自分で選ぶ（例: 前へ進める / じらす / 応える / 聞き出す / 主導を渡す など)。同じ内容の言い換えを並べたら失敗。",
  "台詞は相手へ向けた二人称の言葉にする。相手の呼び名を使ってよい。",
  "どの候補も場面を前へ動かす。ぼかした言い方・話題そらし・比喩でのはぐらかしはせん。",
  "場面がエロなら候補もそのまま具体的に書く。直接的な語を避けて言い換えん。",
  "18歳未満を登場させん。",
  "動作と台詞を合わせて20〜60文字。説明や注釈は書かん。",
  'JSONのみで返す: {"replies":[{"act":"動作","line":"台詞"},{"act":"...","line":"..."},{"act":"...","line":"..."}]}',
  "act は括弧を付けず動作だけを書く。line は改行を含めん一行の台詞だけを書く。",
].join("\n");

export const toReplySuggestionTurn = (row: {
  role: string;
  content: string;
}): ReplySuggestionTurn | null =>
  row.role === "user" || row.role === "assistant" ? { role: row.role, content: row.content } : null;

export const truncateForPrompt = (value: string, maxChars: number): string =>
  value.length <= maxChars ? value : value.slice(0, maxChars);

export const resolvePlayerLabel = (persona: ReplySuggestionPersona | null): string => {
  const sanitized = persona?.name ? escapeNameForPromptQuote(persona.name.trim()) : "";
  return sanitized || PROMPT_SPEAKER_FALLBACK;
};

// assistant の保存本文は <response><action>… の XML。タグのまま渡すと、候補にもタグが
// 混ざる（実測済みの形）。平文へ潰してから履歴に載せる。
export const flattenTurnContent = (turn: ReplySuggestionTurn): string => {
  const plain = turn.role === "assistant" ? stripXmlTags(turn.content) : turn.content;
  return truncateForPrompt(
    sanitizeUserContext(plain, REPLY_SUGGESTION_TURN_MAX_CHARS).trim(),
    REPLY_SUGGESTION_TURN_MAX_CHARS,
  );
};

// 履歴のラベルを user:/assistant: のままにすると、モデルは「assistant の続き」を書く。
// 実際の呼び名を話者ラベルに使うと、候補をどちら側の声で書くかが一行ごとに効く。
export const formatReplySuggestionHistory = (
  turns: ReplySuggestionTurn[],
  characterName: string,
  playerLabel: string,
): string =>
  turns
    .slice(-REPLY_SUGGESTION_HISTORY_TURNS)
    .map((turn) => ({
      speaker: turn.role === "assistant" ? characterName : playerLabel,
      content: flattenTurnContent(turn),
    }))
    // サニタイズで空になったターンをラベルだけ残して並べると、モデルが「無言のターン」を
    // 読み取って候補が沈黙側へ寄る。行そのものを落とす。
    .filter((turn) => turn.content.length > 0)
    .map((turn) => `${turn.speaker}: ${turn.content}`)
    .join("\n");

const formatPersonaLines = (persona: ReplySuggestionPersona | null): string[] => {
  if (!persona) return [];
  const lines: string[] = [];
  const gender = persona.gender?.trim();
  if (gender) lines.push(`プレイヤーの性別: ${gender}`);
  const personality = persona.personality
    ? sanitizeUserPersonaFreeText(persona.personality).trim()
    : "";
  if (personality)
    lines.push(`プレイヤーの人柄: ${truncateForPrompt(personality, 300).replaceAll("\n", " ")}`);
  return lines;
};

export const latestCharacterUtterance = (context: ReplySuggestionContext): string => {
  const latest = [...context.turns].reverse().find((turn) => turn.role === "assistant");
  if (latest) return flattenTurnContent(latest);
  const greeting = context.greeting?.trim();
  // 履歴と同じ経路を通す。ここだけ素通しやと、写し返しの検出に使う文字列が
  // 履歴側の表記と揃わず、第一声をそのまま返した候補を見逃す。
  return greeting ? flattenTurnContent({ role: "assistant", content: greeting }) : "";
};

export const buildReplySuggestionPrompt = (
  context: ReplySuggestionContext,
): Array<{ role: "system" | "user"; content: string }> => {
  const characterName = escapeNameForPromptQuote(context.characterName) || "相手";
  const playerLabel = resolvePlayerLabel(context.persona);
  const history = formatReplySuggestionHistory(context.turns, characterName, playerLabel);
  const characterLatest = latestCharacterUtterance(context);

  const userContent = [
    `相手キャラの呼び名: ${characterName}`,
    `プレイヤーの呼び名: ${playerLabel}`,
    ...formatPersonaLines(context.persona),
    `場面の段階: ${context.scenePhase ?? "未指定"}`,
    "",
    "相手キャラの設定（この子の人柄・関係性の出所。プレイヤーの設定ではない）:",
    truncateForPrompt(
      sanitizeUserContext(context.characterSheet, REPLY_SUGGESTION_SHEET_MAX_CHARS).trim(),
      REPLY_SUGGESTION_SHEET_MAX_CHARS,
    ) || "なし",
    "",
    "直近のやりとり（古い→新しい）:",
    history || "まだやりとりは無い",
    "",
    characterLatest
      ? `${characterName} の直前の発言: ${characterLatest}`
      : `${characterName} はまだ何も言うとらん`,
    "",
    `上を受けて、次に ${playerLabel} が ${characterName} へ送る発言の候補を ${REPLY_SUGGESTION_COUNT} 件作れ。${characterName} の側の発言は書くな。`,
  ].join("\n");

  return [
    { role: "system", content: REPLY_SUGGESTION_SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];
};

export const stripCodeFence = (text: string): string =>
  text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();

export const normalizeStageDirection = (act: string): string =>
  act
    .trim()
    .replace(/^[(（]+/, "")
    .replace(/[)）]+$/, "")
    .replaceAll(/\s+/g, " ")
    .replace(/[、。]+$/, "")
    .trim()
    .slice(0, REPLY_SUGGESTION_ACT_MAX_CHARS);

export const composeReplySuggestion = (act: string, line: string): string => `（${act}）${line}`;

// 話者ラベル。全角括弧より前に「名前:」が来る形だけを見る（ト書きの中のコロンは拾わん）。
const SPEAKER_LABEL_PATTERN = /^([^\n(「」』（]{1,24}?)\s*[:：]\s*(.+)$/s;

const isPlayerLabel = (label: string, playerLabel: string): boolean => {
  const normalized = label.trim().toLowerCase();
  if (normalized.length === 0) return false;
  if (playerLabel.trim().length > 0 && normalized === playerLabel.trim().toLowerCase()) return true;
  return PLAYER_LABEL_ALIASES.includes(normalized);
};

export type SpeakerLabelResult = { line: string; speaker: "player" | "other" | "none" };

// モデルは「次の返信」を頼まれると assistant の続きを書く癖がある。その時ほぼ必ず
// 「鈴: …」のような話者ラベルが付く。プレイヤー側のラベルなら剥がして採用し、
// それ以外（キャラ名・assistant・不明）は彼女の声として落とすための判定。
export const resolveSpeakerLabel = (line: string, playerLabel: string): SpeakerLabelResult => {
  const matched = SPEAKER_LABEL_PATTERN.exec(line.trim());
  if (!matched) return { line: line.trim(), speaker: "none" };
  const [, label, rest] = matched;
  return {
    line: rest.trim(),
    speaker: isPlayerLabel(label, playerLabel) ? "player" : "other",
  };
};

export const isCharacterEcho = (line: string, characterLatest: string): boolean => {
  const normalized = line.trim();
  if (normalized.length < CHARACTER_ECHO_MIN_CHARS) return false;
  return characterLatest.includes(normalized);
};

export type ReplySuggestionValidationContext = {
  playerLabel: string;
  characterLatest: string;
};

// 1件を採用可能な形に整えて返す。落とす理由があれば null。
export const normalizeReplySuggestion = (
  candidate: { act: unknown; line: unknown },
  context: ReplySuggestionValidationContext,
): string | null => {
  if (typeof candidate.act !== "string" || typeof candidate.line !== "string") return null;

  const act = normalizeStageDirection(candidate.act);
  if (act.length === 0) return null;

  const resolved = resolveSpeakerLabel(
    candidate.line.replaceAll(/\s*\n\s*/g, " "),
    context.playerLabel,
  );
  if (resolved.speaker === "other") return null;

  const line = resolved.line.trim();
  if (line.length === 0) return null;
  if (isCharacterEcho(line, context.characterLatest)) return null;

  const composed = composeReplySuggestion(act, line);
  if (composed.length < REPLY_SUGGESTION_MIN_CHARS) return null;
  if (composed.length > REPLY_SUGGESTION_MAX_CHARS) return null;
  return composed;
};

// 「言い換えを3つ」を弾く最低限。狙いの違いは測れんので、台詞の頭が同じものだけ落とす。
const dedupeKey = (suggestion: string): string => suggestion.replace(/^（[^）]*）/, "").slice(0, 8);

export const parseReplySuggestions = (
  content: string,
  context: ReplySuggestionValidationContext,
): string[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(content));
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const replies = (parsed as { replies?: unknown }).replies;
  if (!Array.isArray(replies)) return [];

  const accepted: string[] = [];
  const seen = new Set<string>();
  for (const reply of replies) {
    if (accepted.length >= REPLY_SUGGESTION_COUNT) break;
    if (typeof reply !== "object" || reply === null) continue;
    const normalized = normalizeReplySuggestion(reply as { act: unknown; line: unknown }, context);
    if (normalized === null) continue;
    const key = dedupeKey(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    accepted.push(normalized);
  }
  return accepted;
};

export const requestReplySuggestions = async (input: {
  apiKey: string;
  appOrigin: string;
  apiBase?: string;
  context: ReplySuggestionContext;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<string[]> => {
  const {
    apiKey,
    appOrigin,
    apiBase,
    context,
    timeoutMs = REPLY_SUGGESTION_TIMEOUT_MS,
    fetchImpl = fetch,
  } = input;

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort("reply_suggestion_timeout"), timeoutMs);

  try {
    const base =
      typeof apiBase === "string" && apiBase.length > 0
        ? apiBase.replace(/\/$/, "")
        : "https://openrouter.ai";
    const response = await fetchImpl(`${base}/api/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": appOrigin,
        "X-Title": "Adult Fiction Roleplay Reply Suggestions",
      },
      body: JSON.stringify({
        model: REPLY_SUGGESTION_MODEL,
        messages: buildReplySuggestionPrompt(context),
        stream: false,
        // 3件の狙いを散らすのが要件なので、判定器(temperature 0)とは逆に振る。
        // 「出し直す」で別の組が出ることもこの値に依存しとる。
        temperature: 0.9,
        max_tokens: REPLY_SUGGESTION_MAX_TOKENS,
        response_format: { type: "json_object" },
        provider: buildOpenRouterProviderRouting(REPLY_SUGGESTION_MODEL),
      }),
      signal: abortController.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.warn("reply suggestions failed", response.status, body.slice(0, 300));
      return [];
    }

    const json: { choices?: Array<{ message?: { content?: string } }> } = await response.json();
    const content = json.choices?.[0]?.message?.content?.trim();
    if (!content) return [];

    return parseReplySuggestions(content, {
      playerLabel: resolvePlayerLabel(context.persona),
      characterLatest: latestCharacterUtterance(context),
    });
  } catch (error) {
    console.warn("reply suggestions unavailable", error);
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
};
