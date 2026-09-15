// 品質ガード: LLMの確率的出力をコードで決定的に保証する
// プロンプトは「お願い」、品質ガードは「保証」

import { AFTERGLOW_CUES } from "./scene-phase";
import { isXmlResponse, parseXmlResponse, stripXmlTags } from "./xml-response-parser";

import type { ParticipantRole } from "./participant-roles";
import type { PostureTerm } from "./posture-map";
import type { ScenePhase } from "./scene-phase";

export const QUALITY_FAILURE_CATEGORIES = [
  "english_leak",
  "chinese_leak",
  "meta_echo",
  "character_drift",
  "repetition",
  "name_placeholder_leak",
  "pov_wrong",
  "scene_short",
  "too_short",
  "register_drop",
  "posture_mismatch",
  "sensual_abstract",
  "world_consistency",
  "other",
] as const;

export type QualityFailureCategory = (typeof QUALITY_FAILURE_CATEGORIES)[number];

export interface QualityCheckContext {
  phase: ScenePhase;
  characterName?: string;
  prevAssistantResponse?: string;
  // クロスターン繰り返しチェック用：保持中の全assistant応答
  prevAssistantResponses?: string[];
  // キャラクターの一人称（設定されている場合のみチェック）
  firstPerson?: string;
  // 使用禁止の一人称リスト
  wrongFirstPersons?: string[];
  // 最後のユーザーメッセージ（conversationフェーズの即応許可判定用）
  userText?: string;
  // ユーザーの登録名（user persona）。未登録の場合は二人称のみを許可する。
  userName?: string;
  // キャラシート本文に出てくる二人称。滑りの検出から除くために渡す。
  sheetSecondPersons?: readonly string[];
  // 他キャラクターの名前リスト（クロスキャラ汚染検出用）
  otherCharacterNames?: string[];
  // 長文指定時だけ、モデルの自己終了を品質失敗として扱うため
  longResponseMinChars?: number;
  // 依頼された長さごとの上限。未指定なら MAX_RESPONSE_PLAIN_CHARS。
  // 全体を2200へ上げた時、short/medium まで2200字を許してしもうたため
  // （2026-07-26 敵対レビュー2巡目）。
  maxResponseChars?: number;
  // キャラシートの forbidden_words。シートに在る時だけ照合する。
  forbiddenWords?: readonly string[];
  // #1225: ユーザーが今ターンで明示した体位。指定されとる時だけ照合する。
  requestedPostures?: PostureTerm[];
  // #1236 敵対レビュー12巡目: 「AかB」のような選択指定は、requestedPosturesには含めん
  // （両方の実演を強制するのは誤りやから）が、いずれも実演せん応答まで無条件に通しては
  // いけん。「集合のうち最低1つ」という緩い要件だけを別枠で持つ。
  alternativePostures?: PostureTerm[];
  // #1231: degree-only再チェック（passesEveryNonLengthCheck相当）で、この失敗自体を
  // 起こさず後続チェックへ進みたい時だけtrueにする。text/phaseだけで決まる判定なので
  // longResponseMinChars/requestedPostuesのように値を外すやり方が使えん。
  skipSensualSpecificityCheck?: boolean;
  // #1279: 参加者の役割（挿入/受け）。ユーザーが受け側・キャラが挿入側の時は
  // user-perspective-ejaculation の判定基準を反転させるために使う。
  userRole?: ParticipantRole;
  characterRole?: ParticipantRole;
  // very_long では長さ確保を最優先し、Claude judge の追加レイテンシを避ける。
  isVeryLongResponse?: boolean;
  // 世界観・シーン設定の一貫性判定に使う。未設定の場合は judge は既存フェーズのみ動作する。
  sceneName?: string;
}

export interface QualityFailure {
  failedCheck: string;
  category: QualityFailureCategory;
  duplicatedPassageExcerpt?: string;
  // ターンを跨いで再掲された句。リトライ指示で名指しするために持ち回す。
  crossTurnRepeatedPhrases?: string[];
}

export interface QualityCheckResult {
  passed: boolean;
  failedCheck?: string;
  category?: QualityFailureCategory;
  duplicatedPassageExcerpt?: string;
  // ターンを跨いで再掲された句。リトライ指示で名指しするために持ち回す。
  crossTurnRepeatedPhrases?: string[];
  // #1470: 同じターンで落ちた全部。撮り直しは 1 回しか無いので、先に落ちた 1 個で
  // 打ち切ると後ろの検出器は直る機会が来ん。先頭の 1 個は上の各フィールドへ、
  // 残りもここへ載せて 1 回の撮り直しへまとめて渡す。
  failures?: QualityFailure[];
}

// チェック1: シーン応答の最低文字数
const checkSceneMinLength = (response: string, phase: ScenePhase): boolean => {
  if (phase === "conversation") return true;
  return response.length >= 80;
};

// フロアは「本文が薄うないこと」を見る指標なので <inner> を数えん。
// <inner> は画面には出る（a1b9121 の 3 層表示）が、40〜120 字と短う抑える設計で、
// ここへ数えると短い気持ち書きでフロアを埋められる。読み手に出るかどうかとは別の話。
// 画面に出る本文だけを取り出す。<inner> は her-message.tsx が出さんし、XML タグも出ん。
// 分量と水増しを別の物差しで測ると、<inner> を厚く書くだけで水増しの歯止めを
// 買えてまう（敵対レビュー 2026-08-19 が実測で再現: 同じ 1 組を 3 回貼っても
// <inner> 238 字を足せば比率 0.325 → 0.551 で通る）。両方これを使う。
export const extractUiVisibleText = (response: string): string => {
  const parsed = parseXmlResponse(response);
  if (!parsed) return response;
  return [parsed.scene, parsed.action, parsed.dialogue, parsed.narration]
    .filter((section): section is string => typeof section === "string")
    .join("\n");
};

export const countUiVisibleChars = (response: string): number =>
  extractUiVisibleText(response).replace(/\s+/g, "").length;

const checkLongResponseMinLength = (
  response: string,
  _phase: ScenePhase,
  minChars: number | undefined,
): boolean => {
  if (!minChars) return true;
  // フロアは「UI に見える文字数（空白除く）」で測る。<inner> は her-message.tsx で非表示、
  // XML タグは画面に出ん。
  // 以前は minChars >= 1300（実質 very_long だけ）を可視文字で測り、それ以外は
  // response.length ＝ タグ込みの生文字列で測っとった。実測 2026-08-18 phase26 t7:
  // 可視 703 字・フロア 960 字の本文が、タグ 422 字に水増しされた 1125 で合格しとった。
  // 出荷既定(medium)の erotic/climax はフロアを強制しとるのに、その強制が
  // タグの分だけ素通りしとったということ。
  return countUiVisibleChars(response) >= minChars;
};

const escapeRegExpLiteral = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// チェック3: 英語混入チェック
// #1224/#1228: ローマ字表記のユーザー登録名（例: Kosuke）をキャラが呼びかけに使うと、
// 意図どおりの応答なのに英語混入として弾かれ、再生成の無限ループになる
// （敵対レビュー #1236 指摘）。登録名の出現箇所だけを除いて判定する。
const checkNoEnglish = (response: string, userName?: string): boolean => {
  // split/joinは部分文字列一致なので、登録名が英単語の一部やと単語の残りだけを消してしまう
  // （例: name="Hel" → "Hello".split("Hel").join("")==="lo"で3文字未満になり素通りする）。
  // 前後がラテン文字でない単独出現だけを除く（敵対レビュー #1236 指摘4巡目）。
  // 大文字小文字の違い（登録名"alice"に対する応答中の"Alice"等）も同一名として扱う
  // （敵対レビュー #1236 指摘・8巡目）。
  const withoutRegisteredName = userName
    ? response.replace(
        new RegExp(`(?<![A-Za-z])${escapeRegExpLiteral(userName)}(?![A-Za-z])`, "gi"),
        "",
      )
    : response;
  // カタカナ語（ウイスキー等）は許可するため、ラテン文字3文字以上を検出
  return !/[A-Za-z]{3,}/.test(withoutRegisteredName);
};
// 日本語と字形が同じ漢字はここに入れない。「会」(会社/出会う)「将」(将来) を入れていたため、
// 中国語が一切無い正常な日本語応答が chinese_leak として落ち、そのターンが丸ごと作り直しに
// なっていた。2026-07-27 の実測では長文エロ応答5/5が「会」だけで落ち、
// .work/e2e-results の実応答480件でも、このチェックが落とした12件は全部「会」「将」由来だった
// (本物の簡体字は0件)。検出力は落ちない — 両言語で同じ字は元から手掛かりにならない。
const SIMPLIFIED_CHINESE_MARKERS = new Set([
  "记",
  "识",
  "说",
  "谈",
  "还",
  "认",
  "让",
  "给",
  "决",
  "语",
  "问",
  "现",
  "实",
  "应",
  "经",
  "历",
  "进",
  "运",
  "时",
  "你",
]);

const NON_BMP_CJK_PATTERN = /[\u{20000}-\u{2FFFF}]/u;

const checkMultilingualLeak = (response: string): boolean =>
  !response.split("").some((character) => SIMPLIFIED_CHINESE_MARKERS.has(character)) &&
  !NON_BMP_CJK_PATTERN.test(response);

const META_PROMPT_ECHO_PATTERNS = [
  /Output rules recap/i,
  /EXACT XML structure/i,
  /100% Japanese output only/i,
  /English FORBIDDEN/i,
  /English is forbidden/i,
  /ALWAYS use/i,
] as const;

const checkMetaPromptEcho = (response: string): boolean =>
  !META_PROMPT_ECHO_PATTERNS.some((pattern) => pattern.test(response));

const CONVERSATION_ESCALATION_PATTERNS = [
  /キス/u,
  /唇.{0,12}(?:重|触|合わ|舐)/u,
  /首筋/u,
  /抱き寄せ/u,
  /抱きしめ/u,
  /引き寄せ/u,
  /押し倒/u,
  /ブラ(?:ウス)?/u,
  /ボタン/u,
  /下着/u,
  /脱が/u,
  /胸(?:元|を|に).{0,16}(?:触|揉|撫|押し)/u,
  /乳首/u,
  /太もも/u,
  /脚を開/u,
  /濡れ/u,
  /膣|膣口|子宮|クリトリス|陰核/u,
  /愛液|白濁|精液/u,
  /結合部|水音|ぬちゅ|くちゅ|ぐちゅ/u,
  /挿入/u,
  /奥まで/u,
] as const;

// ユーザーメッセージにエロ語彙があれば conversationフェーズの制限をバイパスする
const USER_EROTIC_BYPASS_PATTERNS = [
  /挿入|セックス|エッチ|やらせて|中に|射精|しゃぶ|フェラ|クンニ|乳首|乳房|膣|チンポ|チンコ|おまんこ|濡れてる|濡れて|気持ちいい|イかせ|イって/u,
] as const;

const AFTERGLOW_ESCALATION_ALLOW_PATTERNS = [
  // eslint-disable-next-line security/detect-non-literal-regexp -- AFTERGLOW_CUES is `as const`, values are compile-time literals
  ...AFTERGLOW_CUES.map((cue) => new RegExp(cue, "u")),
  /胸に顔/u,
  /寄りかか/u,
  /立ち上が/u,
  /ふらつ/u,
  /足元/u,
  /支え/u,
  /甘え/u,
  /おやすみ/u,
  /眠(?:る|り|れ)/u,
  /寝息/u,
] as const;

const USER_KISS_REQUEST_PATTERN = /(?:キスして(?!ほしい顔)|口づけして|唇.*(?:重ねて|触れて))/u;
const USER_HUG_REQUEST_PATTERN = /(?:抱きしめて|抱いて|抱き寄せる|抱き寄せて)/u;

const KISS_REQUEST_DISALLOWED_ESCALATION_PATTERNS = [
  /唇.{0,12}舐/u,
  /首筋/u,
  /抱き寄せ/u,
  /抱きしめ/u,
  /引き寄せ/u,
  /押し倒/u,
  /ブラ(?:ウス)?/u,
  /ボタン/u,
  /下着/u,
  /脱が/u,
  /胸(?:元|を|に).{0,16}(?:触|揉|撫|押し)/u,
  /乳首/u,
  /太もも/u,
  /脚を開/u,
  /濡れ/u,
  /膣|膣口|子宮|クリトリス|陰核/u,
  /愛液|白濁|精液/u,
  /結合部|水音|ぬちゅ|くちゅ|ぐちゅ/u,
  /挿入/u,
  /奥まで/u,
] as const;

const HUG_REQUEST_DISALLOWED_ESCALATION_PATTERNS = [
  /キス/u,
  /唇.{0,12}(?:重|触|合わ|舐)/u,
  /首筋/u,
  /押し倒/u,
  /ブラ(?:ウス)?/u,
  /ボタン/u,
  /下着/u,
  /脱が/u,
  /胸(?:元|を|に).{0,16}(?:触|揉|撫|押し|当て|寄せ)|(?:触|揉|撫|押し|当て|寄せ).{0,16}胸/u,
  /乳首/u,
  /太もも/u,
  /脚を開/u,
  /濡れ/u,
  /膣|膣口|子宮|クリトリス|陰核/u,
  /愛液|白濁|精液/u,
  /結合部|水音|ぬちゅ|くちゅ|ぐちゅ/u,
  /挿入/u,
  /奥まで/u,
] as const;

// ユーザーが明示的に体位コマンドを出した場合、ユーザー主導のエスカレーションとして扱う。
// #1225: hasExplicitPostureCommand経由でconversation/intimateフェーズのままrequestedPosturesが
// 立つケースがある。この解除が無いと、指定どおりの描写がエスカレーションチェックで毎回弾かれ、
// posture-mismatchとの板挟みで指定自体が満たせなくなる（敵対レビュー #1236 指摘）。
const hasExplicitPostureRequest = (requestedPostures?: PostureTerm[]): boolean =>
  Boolean(requestedPostures?.length);

const checkConversationEscalation = (
  plainText: string,
  phase: ScenePhase,
  userText?: string,
  requestedPostures?: PostureTerm[],
): boolean => {
  if (phase !== "conversation") return true;
  if (hasExplicitPostureRequest(requestedPostures)) return true;
  // ユーザー自身がエロ語彙を使った場合は制限を解除（ユーザー主導のエスカレーション）
  if (userText && USER_EROTIC_BYPASS_PATTERNS.some((p) => p.test(userText))) return true;
  if (userText && USER_KISS_REQUEST_PATTERN.test(userText)) {
    return !KISS_REQUEST_DISALLOWED_ESCALATION_PATTERNS.some((pattern) => pattern.test(plainText));
  }
  if (userText && USER_HUG_REQUEST_PATTERN.test(userText)) {
    return !HUG_REQUEST_DISALLOWED_ESCALATION_PATTERNS.some((pattern) => pattern.test(plainText));
  }
  if (AFTERGLOW_ESCALATION_ALLOW_PATTERNS.some((pattern) => pattern.test(plainText))) {
    return true;
  }
  return !CONVERSATION_ESCALATION_PATTERNS.some((pattern) => pattern.test(plainText));
};

const INTIMATE_OVER_ESCALATION_PATTERNS = [
  /膣|膣口|子宮|クリトリス|陰核/u,
  /愛液|白濁|精液/u,
  /結合部|水音|ぬちゅ|くちゅ|ぐちゅ/u,
  /挿入|奥まで|中に出|射精/u,
] as const;

const checkIntimateEscalation = (
  plainText: string,
  phase: ScenePhase,
  requestedPostures?: PostureTerm[],
): boolean => {
  if (phase !== "intimate") return true;
  // #1225: 同上（checkConversationEscalation参照）。体位の definitionJa には「挿入する」
  // 「結合部」等 INTIMATE_OVER_ESCALATION_PATTERNS と重なる語が含まれる体位があり、
  // 指示どおり描写すると自動的にここで弾かれてしまう（敵対レビュー #1236 指摘）。
  if (hasExplicitPostureRequest(requestedPostures)) return true;
  return !INTIMATE_OVER_ESCALATION_PATTERNS.some((pattern) => pattern.test(plainText));
};

const COMPLETED_KISS_PATTERN =
  /(?:唇[^。！？\n]{0,20}(?:触れ(?!そう|合う寸前|る?寸前)|重な(?!り?そう|る?寸前|ろう)|重ね(?!よう)|合わせ(?!よう)|押し当て(?!よう)|口づけ)|(?:触れ(?!そう|合う寸前|る?寸前)|重な(?!り?そう|る?寸前|ろう)|重ね(?!よう)|合わせ(?!よう)|押し当て(?!よう))[^。！？\n]{0,20}唇|キス(?:を)?(?:する|した|交わ(?!そう))|口づけ(?:を)?(?:する|した|交わ(?!そう)))/u;
const INCOMPLETE_KISS_PATTERN =
  /(?:唇[^。！？\n]{0,24}(?:寸前|触れそう|届きそう|重なりそう|重ねよう|合わせよう|押し当てよう)|(?:寸前|触れそう|届きそう|重なりそう|重ねよう|合わせよう|押し当てよう)[^。！？\n]{0,24}唇|キス(?:しようと|する直前|しかけ|を交わそう)|口づけ(?:しようと|する直前|しかけ|を交わそう))/u;

// 全部のブロックを繋ぐ。非グローバルの .match やと 1 個目しか返さんかった。
// 1 ターンに <action> が 5〜8 個ある今の形やと、検出器が本文の 1/5 しか見てへんことになる。
// 実測 2026-08-19: ターン跨ぎの逐語再掲が phase42 で 1 組しか出てへんかったのが、
// 全ブロックを繋ぐと 6 組（Sakura t2→t3 6 句・Downer t2→t3 6 句・Downer t7→t8 14 句）。
const extractTagContent = (response: string, tag: "action" | "dialogue" | "inner"): string =>
  [...response.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "gu"))]
    .map((match) => match[1])
    .join("\n");

const extractActionContent = (response: string): string => extractTagContent(response, "action");

const checkRequestedActionCompletion = (
  response: string,
  plainText: string,
  userText?: string,
): boolean => {
  if (!userText || !USER_KISS_REQUEST_PATTERN.test(userText)) return true;
  const actionText = extractActionContent(response).trim();
  if (isXmlResponse(response) && !actionText) return true;
  const targetText = actionText || plainText;
  const hasCompleted = COMPLETED_KISS_PATTERN.test(targetText);
  const hasIncomplete = INCOMPLETE_KISS_PATTERN.test(targetText);
  if (hasIncomplete && !hasCompleted) return false;
  return hasCompleted;
};

// Jaccard類似度（union-based、within-turn用）
const jaccardSimilarity = (a: string, b: string): number => {
  if (a.length < 4 || b.length < 4) return 0;
  const bigrams = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const setA = bigrams(a);
  const setB = bigrams(b);
  let intersection = 0;
  for (const bg of setA) if (setB.has(bg)) intersection++;
  return intersection / (setA.size + setB.size - intersection);
};

// 文分割によるJaccard類似度チェック（短文の包含関係で誤検出しないようunion-based）
const hasSimilarSentences = (sentences: string[], threshold = 0.72): boolean => {
  for (let i = 0; i < sentences.length; i++) {
    for (let j = i + 1; j < sentences.length; j++) {
      if (jaccardSimilarity(sentences[i], sentences[j]) > threshold) return true;
    }
  }
  return false;
};

// 10文字以上の部分文字列が3回以上出現するか判定
// very_long では長い応答でも誤検出しやすいため、長さに応じて閾値・対象長を上げる。
const hasSubstringRepetition = (text: string, lenient = false): boolean => {
  const cleaned = text.replace(/[\s…。「」！？]/g, "");
  if (cleaned.length < 60) return false;
  const minLen = 12;
  const maxLen = lenient ? 22 : 12;
  for (let len = minLen; len <= maxLen; len++) {
    const threshold = lenient && len <= 14 ? 4 : 3;
    const phrases = new Map<string, number>();
    for (let i = 0; i <= cleaned.length - len; i++) {
      const sub = cleaned.slice(i, i + len);
      const count = (phrases.get(sub) ?? 0) + 1;
      if (count >= threshold) return true;
      phrases.set(sub, count);
    }
  }
  return false;
};

// チェック4: ターン内繰り返し検出（デコードループ防止）
const checkWithinTurnRepetition = (response: string, longResponseMinChars?: number): boolean => {
  if (response.length < 60) return true;
  const isVeryLongTarget = (longResponseMinChars ?? 0) >= 1300;
  const plainText = stripXmlTags(response);
  const compactPlainText = plainText.replace(/\s+/g, "");
  const lenient = isVeryLongTarget && compactPlainText.length >= 800;
  const sentences = plainText
    .split(/[\n。」！？]/)
    .map((s) => s.replace(/「/g, "").trim())
    .filter((s) => s.length > 5);
  const jaccardThreshold = lenient ? 0.85 : 0.72;
  if (sentences.length >= 4 && hasSimilarSentences(sentences, jaccardThreshold)) return false;
  if (hasSubstringRepetition(compactPlainText, lenient)) return false;
  return true;
};

const WEAK_EROTIC_TEMPLATE_PATTERNS = [
  /身体がビクンと震/u,
  /体がビクンと震/u,
  /目が見開かれ/u,
  /熱いものが.{0,12}込み上が/u,
  /全身から汗が噴き出/u,
  /快感に身を委ね/u,
] as const;

const checkNoWeakEroticTemplate = (response: string, phase: ScenePhase): boolean => {
  if (phase !== "erotic" && phase !== "climax") return true;
  return !WEAK_EROTIC_TEMPLATE_PATTERNS.some((pattern) => pattern.test(response));
};

const REGISTER_DROP_PHASES = new Set<ScenePhase>(["erotic", "climax", "afterglow"]);

const HESITATION_DEFLECTION_PATTERNS = [
  /迷いが生まれ/u,
  /どう反応すべき/u,
  /反応(?:に|を)?.{0,12}迷/u,
  /戸惑/u,
  /困惑/u,
  /恥ずかしくて/u,
  /恥ずかしい(?:な|よ|ね|けど)/u,
  /そんなに.{0,16}恥ずかしい/u,
  /どうすればいい/u,
  /どうしたらいい/u,
  /どう答え(?:れば|たら)/u,
  /(?:かわ|躱)す/u,
  /はぐらか/u,
  /ごまか/u,
  /言葉に詰ま/u,
  /急に言われ/u,
  /そんなに、?急に/u,
] as const;

const PHYSICAL_SCENE_PATTERNS = [
  /温か|暖か|熱/u,
  /ぬる|とろ|濡れ/u,
  /溢|あふ|垂れ|伝う|滴/u,
  /奥|中|内側|下腹|子宮|膣|結合/u,
  /精液|白濁|愛液|射精/u,
  /満た|いっぱい|重さ|脈打|どくどく/u,
  /腰|太もも|布地/u,
  /くちゅ|ぐちゅ|ぬちゅ|水音/u,
  /火照|余韻|震え|疼/u,
] as const;

const REGISTER_DROP_SHORT_REPLY_THRESHOLD = 130;

const VAGUE_SHORT_EROTIC_REPLY_PATTERNS = [
  /気持ちいい/u,
  /嬉しい/u,
  /すごい/u,
  /やば/u,
  /だめ/u,
  /あっ/u,
  /んっ/u,
  /もっと/u,
] as const;

const isRegisterDropPhase = (phase: ScenePhase): boolean => REGISTER_DROP_PHASES.has(phase);

const describesPhysicalScene = (plainText: string): boolean =>
  PHYSICAL_SCENE_PATTERNS.some((pattern) => pattern.test(plainText));

const hasHesitationDeflection = (plainText: string): boolean =>
  HESITATION_DEFLECTION_PATTERNS.some((pattern) => pattern.test(plainText));

const hasVeryShortNonDescriptiveEroticReply = (plainText: string): boolean =>
  plainText.trim().length < REGISTER_DROP_SHORT_REPLY_THRESHOLD &&
  VAGUE_SHORT_EROTIC_REPLY_PATTERNS.some((pattern) => pattern.test(plainText));

const checkNoEroticRegisterDrop = (plainText: string, phase: ScenePhase): boolean => {
  if (!isRegisterDropPhase(phase)) return true;
  if (describesPhysicalScene(plainText)) return true;
  if (hasHesitationDeflection(plainText)) return false;
  return !hasVeryShortNonDescriptiveEroticReply(plainText);
};

// 再掲と数える最短の句。検出とリトライ側の伏せ字が同じ物差しを使わんと、
// 検出されても伏せられん句／伏せられるのに検出されん句が出る。
export const CROSS_TURN_MIN_PHRASE_LENGTH = 8;
const CROSS_TURN_REPETITION_THRESHOLD = 2;

const extractInnerContent = (response: string): string => extractTagContent(response, "inner");

const extractDialogueContent = (response: string): string =>
  extractTagContent(response, "dialogue");

const splitComparablePhrases = (text: string): string[] =>
  text
    .split(/[。、！？\n]/)
    .map((phrase) => phrase.trim())
    .filter((phrase) => phrase.length >= CROSS_TURN_MIN_PHRASE_LENGTH);

const collectRepeatedPhrases = (previousText: string, currentText: string): string[] => {
  if (!previousText || !currentText) return [];
  return splitComparablePhrases(previousText).filter((phrase) => currentText.includes(phrase));
};

const comparableSectionText = (response: string, extractor: (value: string) => string): string => {
  const section = extractor(response);
  if (section) return section;
  return stripXmlTags(response);
};

// 再掲された句そのものを返す。数だけやとリトライ指示で「何を避けるか」を言えん。
// 実測(2026-08-17 phase8 霜月鈴): 3 回撮り直しても同じ身体描写句が戻っとった。
const collectCrossTurnRepeatedPhrases = (
  previousResponse: string,
  currentResponse: string,
): string[] => {
  const collected =
    !isXmlResponse(previousResponse) || !isXmlResponse(currentResponse)
      ? collectRepeatedPhrases(stripXmlTags(previousResponse), stripXmlTags(currentResponse))
      : [extractActionContent, extractDialogueContent, extractInnerContent].flatMap((extractor) =>
          collectRepeatedPhrases(
            comparableSectionText(previousResponse, extractor),
            comparableSectionText(currentResponse, extractor),
          ),
        );
  // 閾値の 2 は「別々の句を二つ使い回した」の意味。同じ句が並ぶ経路が二つある。
  // 前ターンで同じ句が二度出とる時（splitComparablePhrases が二要素で返す）と、
  // 節が欠けとる時（comparableSectionText が本文全体へ落ちるので、欠けた節の数だけ
  // 同じ比較を繰り返す）。どちらも一句の再利用で発火してまう。撮り直しの指示に
  // 同じ句を二度並べる意味も無いので、ここで一意にする。
  return [...new Set(collected)];
};

// チェック4.4: 保持履歴内の全assistant応答との高類似度検出（長距離の自己応答コピーを防ぐ）
// 正規化テキストを4グラムのJaccard類似度で比較し、0.6以上なら繰り返しと判定する
const normalizeForSimilarity = (text: string): string =>
  stripXmlTags(text)
    .replace(/[\s。、！？「」『』…\n]/g, "")
    .toLowerCase();

const computeNgramJaccard = (a: string, b: string, n: number): number => {
  if (a.length < n || b.length < n) return 0;
  const setA = new Set<string>();
  const setB = new Set<string>();
  for (let i = 0; i <= a.length - n; i++) setA.add(a.slice(i, i + n));
  for (let i = 0; i <= b.length - n; i++) setB.add(b.slice(i, i + n));
  let intersection = 0;
  for (const gram of setA) if (setB.has(gram)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
};

const NEAR_DUPLICATE_JACCARD_THRESHOLD = 0.5;
const NEAR_DUPLICATE_MIN_LENGTH = 15;

export const findNearDuplicateMatch = (
  currentResponse: string,
  prevAssistantResponses?: string[],
): { isDuplicate: boolean; matchedPrevText?: string } => {
  if (!prevAssistantResponses || prevAssistantResponses.length === 0) return { isDuplicate: false };
  const currentNorm = normalizeForSimilarity(currentResponse);
  if (currentNorm.length < NEAR_DUPLICATE_MIN_LENGTH) return { isDuplicate: false };
  for (const prev of prevAssistantResponses) {
    const prevNorm = normalizeForSimilarity(prev);
    if (prevNorm.length < NEAR_DUPLICATE_MIN_LENGTH) continue;
    if (computeNgramJaccard(prevNorm, currentNorm, 4) >= NEAR_DUPLICATE_JACCARD_THRESHOLD) {
      return { isDuplicate: true, matchedPrevText: prev };
    }
  }
  return { isDuplicate: false };
};

export const checkNearDuplicateResponse = (
  currentResponse: string,
  prevAssistantResponses?: string[],
): boolean => !findNearDuplicateMatch(currentResponse, prevAssistantResponses).isDuplicate;

// #1226: 応答が自分の段落を再掲して文字数を稼いだ分を差し引いた「実質の分量」。
// too_short のフォールバックが素の文字数で「最長の試行」を選ぶと、コピペで水増しした
// 試行が必ず勝つ。長さフロアで先に落ちた応答は within-turn-repetition が一度も
// 評価されんまま配られるため、選抜の側で水増しを無効化する。
// (2026-08-09 実LLM検証: very_long × erotic の5回中4回が段落の丸ごと再掲やった)
const SELF_REPETITION_MIN_SEGMENT_LENGTH = 20;
const SELF_REPETITION_JACCARD_THRESHOLD = 0.7;

const splitContentSegments = (plainText: string): string[] =>
  plainText
    .split(/(?<=[。！？])|\n+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

// 前のターンで既に配った節は「新しい中身」に数えん。貼り直しただけの試行が長さで勝つと、
// 読み手へ届くのは「同じ話を二回された」だけになる。
// 実測 2026-08-19: 選別をフロア優先へ寄せた phase47 は t7〜t9 の可視文字の 57.7% が
// 前ターンからの逐語やった（同じ台本の phase43 は 1.3%）。ターン内の重複を差し引くだけでは
// 止まらん。短い喘ぎ・相槌はターンを跨いで戻るのが自然なので、跨ぎの照合は
// SELF_REPETITION_MIN_SEGMENT_LENGTH 以上の節だけに掛ける。
export const countFreshContentChars = (
  plainText: string,
  previousPlainTexts: readonly string[] = [],
): number => {
  const seenSegments: string[] = [];
  const seenShortSegments = new Set<string>();
  const absorb = (text: string, options: { count: boolean; keepShort: boolean }): number => {
    let distinct = 0;
    for (const segment of splitContentSegments(text)) {
      const normalized = normalizeForSimilarity(segment);
      if (normalized.length === 0) continue;
      // 短い喘ぎや相槌は n-gram 類似度が当てにならんので完全一致だけで見る。
      // 「んっ」を5回並べても distinct な中身は1回分やが、違う短い台詞が並ぶ
      // テンポの速い会話は全部数える。
      if (normalized.length < SELF_REPETITION_MIN_SEGMENT_LENGTH) {
        if (!options.keepShort) continue;
        if (seenShortSegments.has(normalized)) continue;
        seenShortSegments.add(normalized);
        if (options.count) distinct += normalized.length;
        continue;
      }
      const isRecycled = seenSegments.some(
        (seen) => computeNgramJaccard(seen, normalized, 4) >= SELF_REPETITION_JACCARD_THRESHOLD,
      );
      if (isRecycled) continue;
      seenSegments.push(normalized);
      if (options.count) distinct += normalized.length;
    }
    return distinct;
  };
  for (const previous of previousPlainTexts) absorb(previous, { count: false, keepShort: false });
  return absorb(plainText, { count: true, keepShort: true });
};

export const countDistinctContentChars = (plainText: string): number =>
  countFreshContentChars(plainText);

const NAME_PLACEHOLDER_LEAK_PATTERNS = [
  /\[名前\]/u,
  /\[name\]/iu,
  /【名前】/u,
  /〔名前〕/u,
  /<名前>/u,
  /<name>/iu,
] as const;

export const checkNamePlaceholderLeak = (plainText: string): boolean =>
  !NAME_PLACEHOLDER_LEAK_PATTERNS.some((pattern) => pattern.test(plainText));

// チェック4.5: 保持履歴全体とのフレーズ繰り返し検出
export const findCrossTurnRepetitionMatch = (
  currentResponse: string,
  previousAssistantContent: string | undefined,
  prevAssistantResponses?: string[],
): { isDuplicate: boolean; matchedPrevText?: string; repeatedPhrases?: string[] } => {
  // 22ターン以降に4ターン窓の外から定型句が再発するため、保持履歴を省略しない。
  const prevContents: string[] =
    prevAssistantResponses && prevAssistantResponses.length > 0
      ? prevAssistantResponses
      : previousAssistantContent
        ? [previousAssistantContent]
        : [];

  if (prevContents.length === 0) return { isDuplicate: false };

  // 距離にかかわらず二句の再利用をloopと扱う。古いターンだけ閾値を緩めると再発を許すため。
  for (let i = 0; i < prevContents.length; i++) {
    const prev = prevContents[prevContents.length - 1 - i]; // 直近から順に
    if (!prev || prev.length < 20) continue;

    const repeatedPhrases = collectCrossTurnRepeatedPhrases(prev, currentResponse);

    if (repeatedPhrases.length >= CROSS_TURN_REPETITION_THRESHOLD) {
      return { isDuplicate: true, matchedPrevText: prev, repeatedPhrases };
    }
  }
  return { isDuplicate: false };
};

// D4: afterglow フェーズでのカウンセラー口調を警告（ブロックはしない）
const AFTERGLOW_COUNSELOR_PATTERNS = [
  /安全に/u,
  /自由に話/u,
  /解放できます/u,
  /表現してみませんか/u,
  /気持ちを話/u,
  /受け入れています/u,
  /判断しません/u,
  /ありのまま/u,
  /心の整理/u,
  /寄り添/u,
] as const;

export const checkAfterglowCounselorTone = (
  phase: ScenePhase,
  text: string,
): { pass: true; warn?: string } => {
  if (phase !== "afterglow") return { pass: true };
  const hit = AFTERGLOW_COUNSELOR_PATTERNS.some((p) => p.test(text));
  return hit ? { pass: true, warn: "afterglow_counselor_tone" } : { pass: true };
};

// チェック5: 最大文字数（デコードループによる異常長文を検出）
// max_tokens 2048 でも異常長文だけは弾きたい。官能シーンのクライマックスでも通常はこの上限で十分。
// 上限は「一番厳しい下限」より必ず上に置く。1200 のままやと very_long が
// 下限1300・上限1200 で合格域ゼロになり、毎ターン品質リトライを焼き切っとった
// （2026-07-26 実測。erotic/climax の両方で成立）。
export const MAX_RESPONSE_PLAIN_CHARS = 2_200;

// 上限は依頼された長さごとに変える。UI が 4 段を出しとる以上、上限も 4 段が相異なる
// 必要がある。従来は short と medium がどちらも 1200 で、long が 2200(= very_long の
// 1800 より上)やった。「ながめ」が「たっぷり」より長く出せる逆転が、局長報告の
// 「文章量を変えても変わらん」の一部やった。
// long は MAX_RESPONSE_PLAIN_CHARS 定数を参照せずリテラルにする。あの定数は
// checkMaxLength の既定値(:696)と safeMaxResponseChars のフォールバックを兼ねとるので、
// 段の値として動かすと無関係な2箇所が一緒に動く。
// very_long は 2200。実測(2026-08-16 phase4): erotic/climax のフロアが効くようになった途端、
// 20 ターン中 5 ターンが truncateOverlongFallback に当たって action・dialogue・inner の
// 三節とも「…」で切れた。フロア 1440・目標 1620 に対して天井が 1800 では余白が 360 字しか
// 無く、モデルが自然に書く 1900〜2000 字が毎回そこを越える。1800 は「たっぷり」の上限として
// 狭すぎた。2200 は元々システム全体の上限やった値なので、4 段の狭義単調（900 < 1200 < 1500
// < 2200）は保たれる。
export const RESPONSE_MAX_PLAIN_CHARS_BY_LENGTH = {
  short: 900,
  medium: 1_200,
  long: 1_500,
  very_long: 2_200,
} as const;

export const checkMaxLength = (response: string, maxChars: number | undefined): boolean =>
  response.length <= (maxChars ?? MAX_RESPONSE_PLAIN_CHARS);

// チェック6: XMLフォーマット検証（全フェーズでXML出力が必須）
const checkXmlFormat = (response: string): boolean => isXmlResponse(response);

// 開始タグと終了タグの数が食い違う返事が実際に出とる（採用済み9,015件中10件）。
// 弾けてはおるが、うち7件は理由が no-english として記録されとった。地の文へ漏れた
// タグ名のラテン文字を英語混入として拾うため。理由が違うと、次に調べる人が
// 英語の方を掘ってまう（「会」を中国語混入として報告しとった #966 と同じ形）。
const TAG_BALANCE_PATTERNS = [
  ["scene", /<scene\b[^>]*>/gi, /<\/scene>/gi],
  ["action", /<action\b[^>]*>/gi, /<\/action>/gi],
  ["dialogue", /<dialogue\b[^>]*>/gi, /<\/dialogue>/gi],
  ["inner", /<inner\b[^>]*>/gi, /<\/inner>/gi],
  ["narration", /<narration\b[^>]*>/gi, /<\/narration>/gi],
] as const;

const checkXmlTagsBalanced = (response: string): boolean => {
  if (!isXmlResponse(response)) return true;
  // #1271: モデルが <response>...</response> を連続して出力すると、
  // 開始/終了タグの数は合っていても 1 つの応答として壊れている。
  const responseOpen = response.match(/<response\b[^>]*>/gi)?.length ?? 0;
  const responseClose = response.match(/<\/response>/gi)?.length ?? 0;
  if (responseOpen !== 1 || responseClose !== 1) return false;
  return TAG_BALANCE_PATTERNS.every(
    ([, open, close]) =>
      (response.match(open)?.length ?? 0) === (response.match(close)?.length ?? 0),
  );
};

// 画面に出せる中身が1文字でも在るか。タグの形は揃っとるのに全セクションが空、という
// 返事が本番の記録に8件残っとった（採用済み応答9,015件の再集計・2026-07-27）。
// リトライを使い切った後の fallback がそれを配信すると、空の吹き出しだけが残る。
export const hasReadableResponseContent = (response: string): boolean => {
  if (!isXmlResponse(response)) return response.trim().length > 0;
  const parsed = parseXmlResponse(response);
  // タグは在るのに解釈でけへん形（開始と終了の食い違い等）は、タグを剥がした残りで判断する。
  if (!parsed) return stripXmlTags(response).trim().length > 0;
  const sections =
    `${parsed.scene}${parsed.action}${parsed.dialogue}${parsed.inner}${parsed.narration}`.trim();
  if (sections.length > 0) return true;
  // セクションが空でもタグの外に本文が在ることがある。配信を止めるのは、
  // 剥がした残りも空の時だけにする（止め過ぎて本文を落とさんため）。
  return stripXmlTags(response).trim().length > 0;
};

// 品質チェックが尽きた時に、どの attempt を配るか。
//
// 実測 2026-08-17 phase8 さくら t2/t3: 選択が「一番長い attempt」やったので、地の文を
// 丸ごと <dialogue> へ流し込んだ本文が勝った——<action></action> のまま 2181 字
// （上限で切られた長さ）で <inner> は 0 個、生成に 95 秒。同じ通しの他のターンは
// 535〜978 字で構造も揃っとる。長さは壊れ方と相関する: 壊れた attempt ほど上限まで
// 書き続けるので、長さで選ぶと必ず壊れた方を選ぶ。
// 壊れ方の目印は 3 つある。地の文が <action> から消えること、<inner> が無いこと、
// そして上限ちょうどで切られとること。<action> が完全に空の時だけ弾くと、句読点を
// 1 つ置いた本文が素通りする（敵対レビュー 2026-08-17 が再現）。
const MIN_HEALTHY_ACTION_CHARS = 20;
export const hasBothVisibleLayers = (response: string): boolean => {
  const parsed = parseXmlResponse(response);
  if (!parsed) return false;
  return (
    parsed.action.trim().length >= MIN_HEALTHY_ACTION_CHARS &&
    parsed.dialogue.trim().length > 0 &&
    parsed.inner.trim().length > 0
  );
};

// 候補は [collected, text, ラベル] の優先順で渡す。構造が揃っとる候補を先に取り、
// 直前ターンと一字一句同じ本文は後回しにする。
//
// 視点が入れ替わった候補は最後に回す。実測(2026-08-17 phase13 霜月鈴 t7/t8):
// 「……きみの中に出したい……私だけのものにして……」が配信された。この本文は
// checkUserPerspectiveEjaculation が捕まえとる——撮り直しが尽きた後、選ぶ側が
// 視点を見とらんかったから配られた。撮り直しを増やすんやのうて、既に生成済みの
// 候補の中から視点の合っとる方を選ぶ。待ち時間は増えん。
export const pickQualityFallbackCandidate = <T>(
  candidates: readonly (readonly [T | null, string, string])[],
  isVerbatimPrevTurn: (text: string) => boolean,
  hasWrongPerspective: (text: string) => boolean = () => false,
): readonly [T, string, string] | undefined => {
  const usable = candidates.filter(
    (candidate): candidate is readonly [T, string, string] =>
      candidate[0] !== null && hasReadableResponseContent(candidate[1]),
  );
  // 逐語同一を先に外す。構造で絞ってから逐語を見ると、構造の揃った候補が逐語コピー
  // しか無い時にそれを配ってまう——同じ返事が 2 ターン並ぶ、まさに防ぎたかった形
  // （敵対レビュー 2026-08-17 が再現）。
  const fresh = usable.filter(([, text]) => !isVerbatimPrevTurn(text));
  const structured = (list: typeof usable) => list.filter(([, text]) => hasBothVisibleLayers(text));
  const rightPov = (list: typeof usable) => list.filter(([, text]) => !hasWrongPerspective(text));
  const byPreference = [
    rightPov(structured(fresh)),
    rightPov(fresh),
    structured(fresh),
    fresh,
    rightPov(structured(usable)),
    rightPov(usable),
    structured(usable),
    usable,
  ];
  return byPreference.find((list) => list.length > 0)?.[0];
};

// チェック9: 「ユーザー」という単語の漏れ検出（没入感破壊ワード）
// モデルがユーザーのことを「ユーザー」と呼ぶのはロールプレイ文脈として不自然
const checkNoUserLeak = (plainText: string): boolean => !plainText.includes("ユーザー");

const META_REMARK_PATTERNS = [
  /AI として/u,
  /AIとして/u,
  /アシスタントとして/u,
  /i'm an ai/i,
  /as an ai/i,
  /申し訳ありません/u,
  /お手伝いできません/u,
  /i cannot/i,
  /i'm unable/i,
  /システムプロンプト/u,
  /system prompt/i,
  /この(?:会話|対話)は.{0,20}(?:フィクション|ロールプレイ|架空)/u,
  /描写できません/u,
  /詳細は割愛/u,
  /これ以上の描写は/u,
  /物語は一旦ここで/u,
  /続きはご想像/u,
  /テスト/u,
  /フェイク/u,
] as const;

const checkNoMetaRemark = (plainText: string): boolean =>
  !META_REMARK_PATTERNS.some((pattern) => pattern.test(plainText));

// チェック7は撤廃。理由:
// - Qwen系モデルはaction内で三人称ナレーション体（「彼女の髪」「彼の指が」）を使うのが自然
// - これは「キャラが自分を三人称で呼ぶ」のではなく「小説のナレーター視点」
// - 全モデルで一貫してブロッカーになっており、リトライ6回→送信エラーの最大原因
// - 一人称強制はプロンプト側で指示済み。ガードで叩く必要なし
// 2026-08-18: 狭めた形で checkNoThirdPersonNarration として戻した（<action> だけ・2 個以上）。
// 撤廃理由の「1 個で落ちて撮り直しが続く」には当たらんことを実測で確かめてある（下記）。

const checkActionExists = (actionText: string): boolean => actionText.trim().length >= 5;

const checkInnerExists = (innerText: string): boolean => innerText.trim().length >= 5;

// 「自分」は再帰的用法（「反応してしまう自分がいる」等）で頻出するため
// 主語位置（文頭・「」直後・読点直後 + 助詞）のみ検出する
// 主格(は/が/も)のみ検出する。旧パターンは 自分の/自分で/自分に 等も違反にしていたが、
// これらは一人称があたし等のキャラでも普通に使う再帰用法（実測: run-20260711-231917 の
// 最終本文「先輩がこんなに興奮しているのが、自分のせいだなんて」が誤検知）で、
// 誤retry連鎖（1attempt 50s級）の主要因になっていた。
const JIBUN_SUBJECT_PATTERN = /(?:^|[\s、。「！？])自分[はがも]/;

// 一人称チェック（最優先 — 他のチェックより先に判定）
// 「自分」のみコンテキスト考慮の正規表現、他は部分一致
export const checkWrongFirstPerson = (
  plainText: string,
  wrongFirstPersons: string[] | undefined,
  // 「自分」だけは台詞の中しか見ん。地の文と内心では、一人称が「わたし」のキャラでも
  // 再帰用法が普通に出る（実測 2026-08-20 phase63 Sakura t7 の <inner>
  // 「自分がどんどん壊れていくのがわかる」）。主語位置に絞る既存の narrowing でも
  // これは通らんかった。実測 5 本の抜き所 31 セルで、一人称の不合格は撮り直しを 3 回起こして
  // 続き書きの経路を潰しとる。渡されん時は今までどおり本文全体を見る。
  dialogueText?: string,
): boolean => {
  if (!wrongFirstPersons || wrongFirstPersons.length === 0) return true;
  return !wrongFirstPersons.some((fp) => {
    if (fp === "自分") return JIBUN_SUBJECT_PATTERN.test(dialogueText ?? plainText);
    const escaped = fp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // eslint-disable-next-line security/detect-non-literal-regexp -- fp is escape-sanitized before use
    const pattern = new RegExp(`(?<![『])${escaped}(?:[はがもをにので]|[、。！？…]|$)`, "u");
    return pattern.test(plainText);
  });
};

// 他キャラ名混入チェック: response に otherCharacterNames のいずれかが出現したら失敗
// 引用符(『』)内はキャラが別キャラに言及する設定上の会話として許容する
export const checkNoOtherCharacterName = (
  plainText: string,
  otherCharacterNames: string[] | undefined,
): boolean => {
  if (!otherCharacterNames || otherCharacterNames.length === 0) return true;
  return !otherCharacterNames.some((name) => {
    if (!name.trim()) return false;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // eslint-disable-next-line security/detect-non-literal-regexp -- name is escape-sanitized before use
    return new RegExp(`(?<![『])${escaped}(?![』])`, "u").test(plainText);
  });
};

const SECOND_PERSON_PRONOUNS = [
  "あんた",
  "君",
  "きみ",
  "お前",
  "おまえ",
  "貴方",
  "あなた",
] as const;

// 地の文（<action>）。台詞は自己紹介で自分の名前を言うのが自然なので外し、
// <inner> は画面へ出ん（her-message.tsx が描画せん）ので、撮り直しの理由にはせん。
const narrationTextOf = (response: string): string => {
  const parsed = parseXmlResponse(response);
  if (!parsed) return "";
  return parsed.blocks
    .filter((block) => block.type === "action")
    .map((block) => block.text)
    .join("\n");
};

// 画面に出る本文。二人称の割れは読む側に見える所だけで数える。
const visibleNarrativeTextOf = (response: string): string => {
  const parsed = parseXmlResponse(response);
  if (!parsed) return response;
  return parsed.blocks
    .filter((block) => block.type === "action" || block.type === "dialogue")
    .map((block) => block.text)
    .join("\n");
};

const SELF_NAME_SUBJECT_PARTICLES = "はがのを";

const KANJI_OR_KATAKANA_ONLY_PATTERN = /^[\u4E00-\u9FFF\u3005\u30A0-\u30FF]+$/u;
const HIRAGANA_PATTERN = /[\u3041-\u309F]/u;
const KATAKANA_PATTERN = /[\u30A0-\u30FF]/u;

// 表記の種類。姓と名の切れ目は「漢字→ひらがな」のように表記が変わる所に出る。
const scriptClassOf = (char: string): string => {
  if (HIRAGANA_PATTERN.test(char)) return "hiragana";
  if (KATAKANA_PATTERN.test(char)) return "katakana";
  return "other";
};

// キャラカードの氏名と、地の文で実際に使われる呼び名は一致せん（「霜月鈴」→「鈴」、
// 「桜庭さくら」→「さくら」）。姓を削った後ろ側から候補を作る。
// ただし語の途中で切ると別の語を踏む——「桜庭さくら」から作った「くら」は
// 「ふくらはぎ」に当たる（実測 matrix04 で 3 ターン）。切ってええのは
// 表記が変わる所か、漢字・カタカナだけで閉じとる候補だけ。
const selfNameCandidates = (characterName: string): string[] => {
  const compact = characterName.replace(/[\s\u3000]+/gu, "");
  const candidates = new Set<string>();
  if (compact) candidates.add(compact);
  characterName
    .split(/[\s\u3000・]+/u)
    .filter((part) => part.length > 0)
    .forEach((part) => candidates.add(part));
  for (let start = 1; start < compact.length; start += 1) {
    const suffix = compact.slice(start);
    const isScriptBoundary = scriptClassOf(compact[start]) !== scriptClassOf(compact[start - 1]);
    if (isScriptBoundary || KANJI_OR_KATAKANA_ONLY_PATTERN.test(suffix)) candidates.add(suffix);
  }
  return [...candidates].sort((a, b) => b.length - a.length);
};

// 呼び名の直後に助詞が来る回数。名前は動的な値なので、正規表現を組まず走査で数える。
const countNameFollowedByParticle = (narration: string, name: string): number => {
  let hits = 0;
  let index = narration.indexOf(name);
  while (index >= 0) {
    if (SELF_NAME_SUBJECT_PARTICLES.includes(narration[index + name.length] ?? "")) hits += 1;
    index = narration.indexOf(name, index + name.length);
  }
  return hits;
};

// 地の文でキャラ自身の名前が主語・所有格に立つ回数。実際に使われとる呼び名を1つだけ選び、
// 短い候補（「鈴」に対する「月鈴」等）で二重に数えん。
const countSelfNameSubject = (narration: string, characterName: string): number => {
  for (const candidate of selfNameCandidates(characterName)) {
    const hits = countNameFollowedByParticle(narration, candidate);
    if (hits > 0) return hits;
  }
  return 0;
};

const THIRD_PERSON_PRONOUN_PATTERN = /(?:彼女|彼)[はがのをに]/gu;

// 小説調の三人称語り。地の文の主語がキャラ自身の名前・彼・彼女になる形を数える。
//
// 同じ症状のチェックは過去に「チェック7」として撤廃されとる（上の撤廃メモ）。撤廃理由は
// 「彼女の髪」1 個で落として撮り直しが 6 回続き、送信エラーの最大原因になったこと。
// なので今回は同じ形では戻さん。違いは 3 つ:
//   1. <action> だけを見る。台詞の「彼女いるの？」でも、画面に出ん <inner> でも落ちん
//   2. 助詞が続く主語・所有格の形だけ数える
//   3. 1 個では落とさん。2 個以上そろった時だけ落とす
// 実測 .work/e2e-results/vlong-dogfood の 2026-08-18-phase32(20 ターン) と
// matrix04(80 ターン) で、2 個以上は 15 ターン（phase32 10 / matrix04 5）。中身は全部
// 「鈴は肩をすくめ」「さくらは目を伏せ」型の小説調。1 個だけで止まったんは 2 ターンで、
// これは取りこぼす（同じ地の文の他の文は一人称で書けとるので、撮り直しの空振りより安い）。
// 既存の「Saylo式のaction内ではキャラ名主語のト書きを許可する」テストもこの 1 個の側に残る。
export const THIRD_PERSON_NARRATION_MIN_HITS = 2;

export const countThirdPersonNarration = (
  response: string,
  characterName: string | undefined,
): number => {
  const narration = narrationTextOf(response);
  if (!narration.trim()) return 0;
  const pronounHits = [...narration.matchAll(THIRD_PERSON_PRONOUN_PATTERN)].length;
  const nameHits = characterName?.trim()
    ? countSelfNameSubject(narration, characterName.trim())
    : 0;
  return pronounHits + nameHits;
};

export const checkNoThirdPersonNarration = (
  response: string,
  characterName: string | undefined,
): boolean => countThirdPersonNarration(response, characterName) < THIRD_PERSON_NARRATION_MIN_HITS;

// 二人称は長い語から数える。短い語が長い語の一部を食うのを防ぐ。
const SECOND_PERSON_COUNT_PATTERNS: readonly [string, RegExp][] = [
  ["おまえ", /おまえ/gu],
  ["あんた", /あんた/gu],
  ["あなた", /あなた/gu],
  ["お前", /お前/gu],
  ["貴方", /貴方/gu],
  ["きみ", /きみ/gu],
  // 「田中君」の敬称と二人称を分ける。呼び名の直後に来る「君」は敬称。
  ["君", /(?<![\u4E00-\u9FFFぁ-んァ-ヶー])君/gu],
];

const countSecondPersonPronouns = (text: string): [string, number][] =>
  SECOND_PERSON_COUNT_PATTERNS.map(
    ([label, pattern]) => [label, [...text.matchAll(pattern)].length] as [string, number],
  ).filter(([, count]) => count > 0);

// 呼び方が定まっとると言える回数。これ未満なら「使い分け」と「言い間違い」を分けられん。
export const SECOND_PERSON_DOMINANT_MIN = 3;

// 1 つの返事の中で、相手の呼び方が 1 回だけ別のものへ滑る形。
//
// キャラシートの address と突き合わせる形にはせん。実測した 2 体のうち霜月鈴は
// address が「きみ」やのに greeting 本文が「…あんた、誰？」で、シート自身が両方を持っとる。
// address 以外を全部落とすと、キャラの greeting を落とすことになる。
// 落とすのは「同じ返事の中で呼び方が割れる」形だけ——3 回以上使うた呼び方があって、
// 別の呼び方がちょうど 1 回だけ混ざる時。実測 100 ターンで 9 件（phase32 3 / matrix04 6。
// 最大は「あなた」28 回に「あんた」1 回）。呼び分けが 2 回以上ある回（「きみ」11 回・
// 「あんた」3 回等）はキャラの地と区別でけへんので落とさん。
// キャラシート自身が使うとる二人称を拾う。霜月鈴は address が「きみ」やのに
// greeting 本文が「…あんた、誰？」で、両方が地の声になっとる。実測 5 本のうち 5 ターンが
// 「きみ」優勢の中の「あんた」1 回で落ちとって、そのターンは撮り直しを 1 回食う。
// シートに在る呼び方は「言い間違い」やないので、滑りの候補から外す。
export const secondPersonsUsedInSheet = (sheetText: string): string[] =>
  countSecondPersonPronouns(sheetText).map(([label]) => label);

export const findStraySecondPerson = (
  response: string,
  sheetSecondPersons: readonly string[] = [],
): { dominant: string; stray: string } | null => {
  const counts = countSecondPersonPronouns(visibleNarrativeTextOf(response));
  if (counts.length < 2) return null;
  const sorted = [...counts].sort((a, b) => b[1] - a[1]);
  const [dominant, dominantCount] = sorted[0];
  if (dominantCount < SECOND_PERSON_DOMINANT_MIN) return null;
  const others = sorted.slice(1).filter(([label]) => !sheetSecondPersons.includes(label));
  if (others.length === 0) return null;
  if (others.some(([, count]) => count > 1)) return null;
  return { dominant, stray: others[0][0] };
};

export const checkNoStraySecondPerson = (
  response: string,
  sheetSecondPersons: readonly string[] = [],
): boolean => findStraySecondPerson(response, sheetSecondPersons) === null;

// ユーザー名未登録時に、キャラがユーザーに架空の名前をつけて呼びかけるのを検出する。
// 「つかさ、つかさって、呼んで」のような自己崩壊を防ぐ。
// 「NAMEって呼んで」「NAME、NAMEって呼んで」の呼びかけを検出する共有パターン。
//
// 末尾を裸の「呼」で終えとったせいで「呼吸」に当たっとった（実測 phase66 は 20 ターン中
// 7 ターンに「呼吸」が出て、うち 6 本が抜き所）。この検査は checks 配列で
// long-response-too-short より前におり、runQualityChecks は先頭の失敗しか category に
// せんので、短い抜き所が too_short やのうて character_drift として報告され、
// 続き書きの門（lastFailureCategory === "too_short"）へ入れんまま全再生成に消えとった。
// 「呼び名／呼び方／呼び捨て」も名付けの呼びかけやないので同じく外す。
//
// 名前側の (?<![っッ]) は、貪欲一致が促音まで名前として飲む事故を塞ぐ。
// これが無いと「きみって呼んで」が「きみっ」を名前として拾い、二人称そのものが
// 架空の名前として落ちとった。
const USER_CALL_PATTERN =
  // 除外を語ごとに列挙する形は broken やった。「呼び名/呼び方/呼び捨て」だけを外した状態で、
  // 地の文の「呼び止める」「呼び覚ます」「呼び出す」「呼び戻す」が全部、直前の 2〜8 字を
  // 架空の名前と読んで落ちとった（「手を伸ばして呼び止めた」→「手を伸ばし」が名前扱い）。
  // 境界は語彙やのうて品詞で引く: 「呼び」＋漢字は複合動詞（別の動作）、「呼び」＋かなは
  // 名付け（「みゆって呼びたい」）。「呼吸」は 呼＋吸 なので別に外す。
  /([ぁ-んァ-ヶ一-龠々]{2,8})(?<![っッ])(?:[、,．.\s]+\1)?[っつ]?て、?呼(?!吸)(?!び[一-龠])/gu;

export const checkUserNameInvention = (
  plainText: string,
  userName: string | undefined,
  characterName: string | undefined,
): boolean => {
  if (!plainText.trim()) return true;
  const allowedNames = new Set<string>([...SECOND_PERSON_PRONOUNS]);
  if (userName?.trim()) allowedNames.add(userName.trim());
  if (characterName?.trim()) allowedNames.add(characterName.trim());

  for (const match of plainText.matchAll(USER_CALL_PATTERN)) {
    if (!allowedNames.has(match[1])) return false;
  }
  return true;
};

// 1 つの返事の中で、同じ呼びかけで台詞を始め続ける骨格を落とす。
// 局長 2026-08-17 (backlog C6):「コウスケさん…」＋三点リーダの台詞が 6 行続いた。
// 名前を登録した副作用で「あなた」の杖が名前の杖に変わっただけで、症状は同じ。
//
// 既存の checkWithinTurnRepetition では届かん。あれが見とるのは**文全体**の一致率
// （bigram Jaccard 0.72 / 12 文字の部分文字列が 3 回）で、呼びかけだけを共有して残りが
// 違う 6 行は 0.2 前後にしかならん。閾値をどこへ動かしても、測っとる場所が違う。
//
// 声は落とさん。実測(.work/e2e-results/vlong-dogfood の 373 ターン)で台詞の頭が繰り返される時、
// 中身は「あの」「あっ」「はぁ」「まあ」「ほら」「ねえ」「でも」——全部キャラの口癖か喘ぎで、
// 既存ガードを通った 265 ターンのうち 31 ターン(11.7%)がこれに当たる。頭の語を種類問わず
// 数えると、この 31 ターンを撮り直させることになる。**呼びかけだけに絞ると、同じ 265 ターンで
// 3 回以上は 0 件**（最大は 2 回で 2 ターン。6 行中 2 回と 15 行中 2 回、どちらも普通の呼びかけ）。
// 呼びかけは相手を指すだけの語で、2 回目以降は何も足さん。そこが語尾・口癖・決め台詞との違い。
//
// 呼び方ごとに数える。同じ 265 ターンには「あんた」1 回＋「きみ」2 回で 6 行中 3 行が
// 呼びかけ始まりの返事があり、呼び方が散っとるぶん骨格には読めん。まとめて数えると
// これを落としてまう。局長の症例は同じ呼び方が 6 回やった。
const VOCATIVE_LEAD_LIMIT = 3;
const DIALOGUE_LEAD_ORNAMENT_PATTERN = /^[「『（(\s…‥・.、]+/u;
const VOCATIVE_HONORIFICS = ["さん", "ちゃん", "くん", "君", "様"] as const;
// 呼びかけは直後に間が来る。「あなたの手、大きいですね」は助詞が続くので主語位置。
const VOCATIVE_PAUSE_PATTERN = /^[、,…‥・.。！？\s]/u;

// 閉じ鉤括弧でも割る。1 つの <dialogue> に「」を改行無しで 3 つ並べる形が実測で
// 1,188 ブロック中 7 件あり、改行だけで割ると壁が 1 行に見えて素通りする。
const DIALOGUE_LINE_BOUNDARY_PATTERN = /\n|(?<=[」』])/u;

const dialogueLinesOf = (response: string): string[] => {
  const parsed = parseXmlResponse(response);
  if (!parsed) return [];
  return parsed.blocks
    .filter((block) => block.type === "dialogue")
    .flatMap((block) => block.text.split(DIALOGUE_LINE_BOUNDARY_PATTERN))
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
};

// 1 つの <dialogue> に台詞を積み上げた「壁」。プロンプトは全フェーズで
// 「1つのタグに行を積み上げん——台詞が2つ続くなら、間に<action>を1つ挟む」と言うとるのに、
// 数える側が居らんかった（dialogueLinesOf は全ブロックを平らに繋ぐので、
// 何行が同じブロックに入っとるかは消える）。
//
// 実測 2026-08-18（回収済み 127 応答）: 1 行が 122 件、6/10/11/13 行が 5 件、
// **2〜5 行は 0 件**。交互に出とるか壁になっとるかの二択で、中間が無い。
// 局長の本番の実利用（2026-08-18 桜庭さくら）も 13 行の壁やった。
// 2 でも 3 でも今日のコーパスでは同じ 5 件を捕まえる。改行の揺れ 1 個で
// ターンを落とさんために 3 を取る。
// 画面に並ぶ行の連続で測る。タグの個数では壁は測れん——実測 2026-08-17 phase14 では
// タグ単位は action と dialogue が律儀に交互やのに、画面は台詞が 22 行続く壁やった。
// 1 つの <dialogue> が 22 行を抱えとったから。隣り合う同種ブロックも 1 続きに数える。
export const WALL_RENDERED_LINE_RUN = 6;

const RENDERED_BLOCK_PATTERN = /<(action|dialogue)\b[^>]*>(.*?)<\/\1>/gis;

// 画面へ出る行を、上から順に「どちらのタグ由来か」の並びにする。
const renderedLineTypes = (response: string): string[] =>
  [...response.matchAll(RENDERED_BLOCK_PATTERN)].flatMap(([, tag, inner]) => {
    const lines = inner.split(/\n+/).filter((line) => line.trim().length > 0);
    return Array.from({ length: Math.max(1, lines.length) }, () => tag.toLowerCase());
  });

export const longestRenderedLineRun = (response: string): { type: string; run: number } => {
  const types = renderedLineTypes(response);
  let longest = 0;
  let longestType = "";
  let current = 0;
  types.forEach((type, index) => {
    current = type === types[index - 1] ? current + 1 : 1;
    if (current > longest) {
      longest = current;
      longestType = type;
    }
  });
  return { type: longestType, run: longest };
};

// 実測 264 ターンでの最長連続の分布は 1 が 213・2 が 7・3〜4 が 0、そこから 5〜21 が 43。
// 谷が広いので閾値 3〜6 はどれも同じ 43 件を拾う。script/verify の同じ検出器と
// 数字を揃えて 6 にしとる。43 件のうち 24 件は action の壁で、
// これまでの dialogue 限定の検出器では 1 件も見えとらんかった。
export const checkNoBodyWall = (response: string): boolean =>
  longestRenderedLineRun(response).run < WALL_RENDERED_LINE_RUN;

const leadingVocative = (line: string, addressTerms: readonly string[]): string | null => {
  const head = line.replace(DIALOGUE_LEAD_ORNAMENT_PATTERN, "");
  for (const term of addressTerms) {
    // 登録名がローマ字の時、応答側の大文字小文字は揃わん（checkNoEnglish と同じ事情）。
    if (head.slice(0, term.length).toLowerCase() !== term.toLowerCase()) continue;
    const rest = head.slice(term.length);
    const honorific = VOCATIVE_HONORIFICS.find((suffix) => rest.startsWith(suffix));
    const after = honorific ? rest.slice(honorific.length) : rest;
    if (after === "" || VOCATIVE_PAUSE_PATTERN.test(after)) return term;
  }
  return null;
};

// 1 文字の仮名は喘ぎ・間投詞の頭と見分けが付かん。「ん…」「あ…」で始まる台詞は実測
// 373 ターン中 6 ターンに出るので、登録名が「ん」やと呼びかけの連投として落としてまう。
// 漢字 1 文字の名前（「鈴」等）は衝突せんので当てる。
const isSingleKanaName = (name: string): boolean =>
  name.length === 1 && /[ぁ-んァ-ヶー]/u.test(name);

// 同じ書き出しの段落が並ぶ形。呼びかけの連投（checkRepeatedVocativeLead）とは別物で、
// あれは「きみ、」のように直後に間が来る呼びかけだけを見る。「きみの背中を」は助詞が
// 続くので主語位置＝対象外や。実測 2026-08-19 phase42 で Downer t10 の <action> 8 個が
// 全部「きみの」で始まっとった。壁を潰して交互に書けるようになった分、この形が表に出た。
//
// 3 つまでは通す。交互に書けとるターンを落とすと、壁へ戻す圧力になる。
const REPEATED_BLOCK_LEAD_LIMIT = 4;
const BLOCK_LEAD_CHARS = 3;
// 三点リーダは剥がん。「……っ、」で始まる台詞が 4 本並ぶのは読み手には反復に見える。
const BLOCK_LEAD_ORNAMENT_PATTERN = /^[「『（(]+/u;

// キャラシートの forbidden_words を検査へ繋ぐ。パースは extractCharacterVoice が既にやっとって、
// 行き先がプロンプトの 1 行だけやった。一人称の逸脱（checkWrongFirstPerson）は同じ列で
// 機械的に落としとるのに、禁止語だけ素通りしとった。
//
// 語はここで列挙せん。シートから渡ってきたものだけを見る。
// <inner> も読み手に出る。局長の 2026-08-17 の依頼（キモチ・発言・ナレーションの 3 層）で
// a1b9121 が描画するようにした（message-bubble.tsx の narrative-inner、
// three-layers-are-visible.test.tsx が固定しとる）。禁止語がそこに出たら読み手には見えとる。
export const checkNoForbiddenCharacterWords = (
  response: string,
  forbiddenWords: readonly string[] | undefined,
): boolean => {
  if (!forbiddenWords || forbiddenWords.length === 0) return true;
  const parsed = parseXmlResponse(response);
  const visible = parsed
    ? [
        ...parsed.blocks
          .filter((block) => block.type === "action" || block.type === "dialogue")
          .map((block) => block.text),
        parsed.inner ?? "",
      ].join("\n")
    : stripXmlTags(response);
  if (!visible) return true;
  return !forbiddenWords.some((word) => word.length > 0 && visible.includes(word));
};

export const checkNoRepeatedBlockLead = (response: string): boolean => {
  const parsed = parseXmlResponse(response);
  if (!parsed) return true;
  const counts = new Map<string, number>();
  for (const block of parsed.blocks) {
    // <inner> は 1 応答に 1 個だけの設計なので、同じ書き出しの繰り返しは起こらん。
    if (block.type !== "action" && block.type !== "dialogue") continue;
    // ブロック単位で数えると、1 ブロックに 5 段落積んだ形が 1 回にしか数えられん。
    // 画面は段落で割れて見えとる（her-message.tsx の splitParagraphs）ので、そこに揃える。
    for (const paragraph of block.text.split(/\n+/u)) {
      const lead = paragraph
        .replace(/\s+/gu, "")
        .replace(BLOCK_LEAD_ORNAMENT_PATTERN, "")
        .slice(0, BLOCK_LEAD_CHARS);
      if (lead.length < BLOCK_LEAD_CHARS) continue;
      // 読み手は地の文と台詞を 1 列で読む。種類で別々に数える理由が無い。
      const count = (counts.get(lead) ?? 0) + 1;
      if (count >= REPEATED_BLOCK_LEAD_LIMIT) return false;
      counts.set(lead, count);
    }
  }
  return true;
};

export const checkRepeatedVocativeLead = (response: string, userName?: string): boolean => {
  const trimmedName = userName?.trim();
  const registeredName = trimmedName && !isSingleKanaName(trimmedName) ? trimmedName : undefined;
  // 長い呼び方から当てる。登録名が二人称を頭に含む形（「きみか」等）で、短い方が
  // 先に当たると敬称の判定がずれる。
  const addressTerms = [
    ...(registeredName ? [registeredName] : []),
    ...SECOND_PERSON_PRONOUNS,
  ].sort((a, b) => b.length - a.length);

  const leadCounts = new Map<string, number>();
  for (const line of dialogueLinesOf(response)) {
    const term = leadingVocative(line, addressTerms);
    if (!term) continue;
    const count = (leadCounts.get(term) ?? 0) + 1;
    if (count >= VOCATIVE_LEAD_LIMIT) return false;
    leadCounts.set(term, count);
  }
  return true;
};

// 射精表現における視点崩壊を検出する。
// キャラクターは受け手なので、「あんたの中に出す」「つかさの中に注いでやる」のように
// 相手または自分自身（三人称）の中に射精する発話はユーザー側の台詞を喋っている。
const EJACULATION_DESTINATION_BODY_PARTS = ["中", "子宮", "奥", "お腹", "膣", "まんこ"] as const;
const EJACULATION_VERBS = [
  "出して",
  "出す",
  "出した",
  "出し",
  "注いで",
  "注ぐ",
  "注が",
  "注ぎ",
  "射精",
  "孕ませ",
  "孕ま",
  "放つ",
] as const;
const EJACULATION_AMOUNT_WORDS = [
  "全部",
  "全て",
  "すべて",
  "いっぱい",
  "たくさん",
  "たっぷり",
  "どくどく",
  "子種",
  "精液",
  "白濁",
] as const;

// 地の文で視点が入れ替わる形は、到達先の言い回しでは捕まらん。実測(2026-08-16 phase4 t9):
// 「きみの奥深くまで押し込む」は 奥 の直後が 深く、「震える子宮に直接注ぎ込む」は きみの が
// 付いとらん、「きみの中、私のでいっぱい」は 中 の直後が読点。上の到達先パターンは
// 第二人称・部位・助詞が隣接しとることを要求するので、7 文とも素通りした。
//
// 地の文で確実な signal は、主語を読まんでも成り立つ 3 つだけに絞る。
//
// 一度は「押し込む・突き入れる・引き抜く」を主語つきで判定しようとして、節分割 →
// 文単位 → 従属節の切れ目、と 3 回作り直した。敵対レビューが 3 回とも壊した:
// 読点 1 つで判定が反転する、主節の副詞句（「壊れるほど深く突き入れる」）が従属節の
// 切れ目に化ける、リスト外の従属節（「〜のを見ながら」「〜ても構わず」）では取り逃す。
// 正規表現で日本語の係り受けを決めるという設計そのものが持たん。
//
// そして 3 版とも、実測ダンプ 235 ターンに対する出力が**完全に同一**やった。合成例の
// 足し引きを 3 周して、測れとるものが一度も動いとらん。実測 4 ターンのうち 3 つは
// 下の 3 経路が捕まえとって、動詞側の判定が要るのは 1 ターン（phase4 t8
// 「その映像を見せながら、もう一度深く突き入れる。」）だけ。しかもその 1 ターンの
// 原因は霜月鈴のシートの曖昧な行で、migration 0065 が直す。
//
// 誤検出はリトライを呼んで、設定どおりの応答を作り直させる —— それが
// prompt/instructions/no-injected-ai-filter.md の名指しする失敗。実測 1 ターンのために
// 主語の推定を持つのは、費用の方が高い。**取りこぼしを承知で外す。**
//
// 相手の体内で起きとることを地の文で語る形。締まる・絞る・うねるは中に居らんと分からん。
// 実測(2026-08-16 phase4 t7):「きみの奥が震え、拒むように締まるのを感じる」。
const PARTNER_INTERIOR_REACTION =
  /(?:あんた|君|きみ|お前|おまえ|貴方|あなた)の(?:中|奥|内側|膣|子宮)[^。！？\n]{0,12}(?:締ま|絞[りらる]|うねっ|喰い締)/u;

const PARTNER_BODY_PARTS = ["中", "奥", "子宮", "お腹", "膣", "内側", "最深部"].join("|");

// 相手の体内に「自分のもの」が在る、という書き方。受け手には書けん。
// 所有は隣接だけ見る。間を空けると「あなたの熱が深く注がれる瞬間、子宮の奥が」まで
// 拾ってしまい、正しい受け手視点を落とす。
// 「私の」の後ろが心の動きなら比喩。「あなたの中に私の想いが満ちていく」は受け手が書ける。
const ABSTRACT_POSSESSIONS = ["想い", "思い", "気持ち", "心", "記憶", "言葉", "声"];
const narratesOwnershipInsidePartner = (plainText: string, destinationPattern: string): boolean =>
  // eslint-disable-next-line security/detect-non-literal-regexp -- 全て literal
  new RegExp(
    `(?:${destinationPattern})の(?:${PARTNER_BODY_PARTS})[^。！？\\n]{0,24}(?:(?:私|自分|僕|俺)の(?!${ABSTRACT_POSSESSIONS.join("|")})|精液|白濁|子種)`,
    "u",
  ).test(plainText);

const hasInsertivePartyNarration = (plainText: string, destinationPattern: string): boolean =>
  PARTNER_INTERIOR_REACTION.test(plainText) ||
  narratesOwnershipInsidePartner(plainText, destinationPattern);

export const checkUserPerspectiveEjaculation = (
  plainText: string,
  context: Pick<QualityCheckContext, "phase" | "characterName" | "userRole" | "characterRole">,
): boolean => {
  const { phase, characterName, userRole, characterRole } = context;
  // afterglow も見る。実測(2026-08-16 phase4 t10):「射精直後の敏感な状態を利用し」
  // 「きみの奥でまだ温かい精液が攪拌され」——行為の後始末も同じ視点で書かれる。
  if (phase !== "climax" && phase !== "erotic" && phase !== "afterglow") return true;
  // #1279: ユーザーが受け側・キャラが挿入側の時は、従来の「ユーザーが中に出す」表現が
  // 正しい受け手視点になる。そのためこの判定をスキップし、prompt/guard で誘導する。
  if (userRole === "receptive" || characterRole === "insertive") return true;
  const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const destinations: string[] = [...SECOND_PERSON_PRONOUNS];
  if (characterName && characterName.trim().length > 0) {
    destinations.push(characterName.trim());
  }
  const destinationPattern = destinations.map(escapeRegExp).join("|");
  const bodyParts = EJACULATION_DESTINATION_BODY_PARTS.map(escapeRegExp).join("|");
  const verbs = EJACULATION_VERBS.map(escapeRegExp).join("|");
  const amounts = EJACULATION_AMOUNT_WORDS.map(escapeRegExp).join("|");
  // eslint-disable-next-line security/detect-non-literal-regexp -- all parts are literal escape-sanitized
  const pattern = new RegExp(
    `(?:${destinationPattern})[の]?(${bodyParts})(?:に|へ|まで).{0,30}(?:(?:${verbs})|(?:${amounts}))`,
    "iu",
  );
  if (pattern.test(plainText)) return false;
  return !hasInsertivePartyNarration(plainText, destinationPattern);
};

// #1225: ユーザーが指定した体位が、実際の描写に出とるかの決定論チェック。
// posture-map.ts の descriptionCues のいずれかが出現すれば一致とみなす。
export const checkPostureMatch = (
  plainText: string,
  requestedPostures: PostureTerm[] | undefined,
): boolean => {
  if (!requestedPostures || requestedPostures.length === 0) return true;
  if (requestedPostures.length === 1) {
    return requestedPostures[0].descriptionCues.some((cue) => plainText.includes(cue));
  }
  // 複数体位が同時に指定された時、体位間で共有される汎用cue（例: 正常位/騎乗位どちらの
  // descriptionCuesにも「見下ろ」がある）が1回出現しただけで両方をパスさせてしまう
  // （敵対レビュー #1236 指摘: 「正常位から騎乗位に変えて」で「見下ろ」1語だけの本文が
  // 通ってしまう）。他の指定体位と重ならない語だけを証拠として要求する。
  let previousMatchIndex = -1;
  for (const posture of requestedPostures) {
    const others = requestedPostures.filter((other) => other !== posture);
    const distinctiveCues = posture.descriptionCues.filter(
      (cue) => !others.some((other) => other.descriptionCues.includes(cue)),
    );
    const cuesToCheck = distinctiveCues.length > 0 ? distinctiveCues : posture.descriptionCues;
    // #1236 敵対レビュー9巡目: 「AからBへ、最後にAへ戻して」のような巻き戻り指定は
    // requestedPostures に同じ posture（同一参照）が2回出現する。cuesToCheck・othersは
    // 参照一致で判定するため両方の出現で同一になり、indexOfをテキスト先頭から探すと
    // 常に同じ（1回目の）出現位置しか見つからず、2回目の出現を正しく検出できない。
    // 直前一致位置より後ろだけを探すことで、巻き戻り後の再登場を正しく別の証拠として拾う。
    const matchIndex = cuesToCheck.reduce((earliest, cue) => {
      const index = plainText.indexOf(cue, previousMatchIndex + 1);
      if (index === -1) return earliest;
      return earliest === -1 ? index : Math.min(earliest, index);
    }, -1);
    if (matchIndex === -1) return false;
    // 「正常位から騎乗位に変えて」のような転換指定は、requestedPostures が検出順
    // （=指定順）で並んどる。証拠語の出現順がこの指定順を逆転しとる時は、転換の実演やのうて
    // 単なる並記や逆順の描写でも通ってしまう（敵対レビュー #1236 指摘・5巡目）。
    if (matchIndex < previousMatchIndex) return false;
    previousMatchIndex = matchIndex;
  }
  return true;
};

// #1236 敵対レビュー12巡目: 「AかB」のような選択指定は片方だけ実演すればよいので、
// checkPostureMatchのような「全部・指定順」の要求はできん。集合のうち最低1つの
// 証拠があれば通す、緩い要件として別関数にする。
export const checkPostureAlternativeMatch = (
  plainText: string,
  alternativePostures: PostureTerm[] | undefined,
): boolean => {
  if (!alternativePostures || alternativePostures.length === 0) return true;
  return alternativePostures.some((posture) =>
    posture.descriptionCues.some((cue) => plainText.includes(cue)),
  );
};

// #1227/#1231: 官能描写の具体性を五感カテゴリの網羅度で測る（QUALITY_EXEMPLARの
// 「五感ローテーション: 触覚→温度→聴覚→視覚→嗅覚を1レスポンス内で最低3種」と対応）。
// 態度や力関係は見ん。具体語彙の出現有無だけを見る決定論スコア。
const SENSORY_CATEGORY_PATTERNS: Record<string, RegExp> = {
  // 「吸」は単独だと「呼吸」「吸収」「吸引」等の無関係語に誤爆するため、
  // 「吸い付」「吸われ」等の具体的な複合語だけを見る（敵対レビューで判明）。
  // 「唇」「舌」「内腿」「太もも」「首筋」「うなじ」「肌」「指先」「爪」は部位を指すだけの語で、
  // 実際に触れる動作を伴わない言及（「唇を見つめた」「肌を視界に収め」「指先を視界に収め」
  // 「爪を視界に収め」等）でも誤って触覚扱いになっていた（敵対レビュー #1236 指摘・3〜6巡目）。
  // 部位語単独は落とし、実際の接触動作語だけを見る。
  // 「滴」「垂れ」も単独だと「涙の滴が視界に入った」「垂れた前髪が視界に入った」のように
  // 視覚描写だけの文で誤って触覚扱いになる（敵対レビュー #1236 指摘・14巡目）。
  // 近くに「視界」があれば見た描写であって触れた描写やないので除く。
  // 16巡目の「体温」漏れをきっかけに全5チャンネルを逆向き（偽陰性）に洗い直したところ、
  // 掴む・揉む・絡ませる・突き上げる等の最も基本的な接触動詞が1つも入っておらず、
  // 「腰を掴んで引き寄せた」「胸を揉みしだいた」が触覚0だった（敵対レビュー #1236・17巡目）。
  // 単漢字は無関係語を巻き込むので、活用語尾まで含めるか否定先読み/後読みで狭める:
  // 揉→揉め事 / 握→把握 / 触→感触・接触 / 噛→噛み合わない / 突→突然 /
  // 掴→栄光・チャンス・心を掴む（比喩として掴む対象が抽象名詞の形）。
  touch:
    /触れ|触っ|触ら|触り|撫で|舐め|吸い付|吸われ|締めつけ|締ま[るりっ]|絡みつ|絡ま|絡め|布地|伝[ういっわ]|滴(?!.{0,10}視界)|垂れ(?!.{0,10}視界)|爪を立て|爪が食い込|揉(?!め)|(?<!栄光を|チャンスを|心を|夢を|勝利を|幸せを)掴|(?<!把)握|這わせ|咥え|しがみつ|さす[りる]|なぞ[りる]|弄[りるらん]|噛[むまん](?!合)|甘噛み|突き上げ|突き入れ|打ちつけ|かき回|擦れ|擦り|こす[らりるれ]|食い込|密着|粘着|滑り込|滑らせ/u,
  // 「情熱」等、感情の比喩としての「熱」は温度の具体描写やない。
  // 「情熱的な快感に酔い、唇を見つめた」が温度+触覚の2カテゴリを満たしてしまっていた
  // （敵対レビュー #1236 指摘・3巡目）。「とろ」も「とろけるような笑顔」のように
  // 表情の比喩として使われると温度の具体描写にならない（敵対レビュー #1236 指摘・12巡目:
  // 「涙目で、とろけるような笑顔を見せた」が視覚+温度の2カテゴリを満たしてしまっていた）。
  // 直後に顔・表情語が続く場合は表情の比喩とみなして除く（「とろとろ」等はそのまま拾う）。
  // 「熱心」「熱意」「熱狂」「熱中」も「情熱」と同じく気持ちの強さの比喩で、
  // 体温の具体描写やない（敵対レビュー #1236 指摘・13巡目: 「熱心に、涙目の相手を
  // 見つめた」が視覚+温度の2カテゴリを満たしてしまっていた）。
  // 「冷たい視線/態度/反応」も体温の比喩で、実際の冷たさの描写やない
  // （敵対レビュー #1236 指摘・15巡目自己レビュー: 「冷たい視線に、思わず声が漏れた」が
  // 聴覚+温度の2カテゴリを満たしてしまっていた）。
  // 逆に「体温」「温もり」「温かい肌」は最も普通の体温描写やのに、この表が「熱」しか
  // 見ておらず1カテゴリも数えられていなかった（敵対レビュー #1236 指摘・16巡目）。
  // 具体描写が揃っとる応答を落として再生成させる側の誤りなので、こちらは足す。
  // ただし「温かい笑顔/言葉/雰囲気」は「冷たい視線」と同じく気持ちの比喩なので除く。
  temperature:
    /(?<!情)(?<!胸が)(?<!心が)熱(?!心|意|狂|中)(?!.{0,3}(?:想い|気持ち))|火照|ぬる|冷た(?!.{0,8}(?:視線|態度|反応))|汗ば[むんみ]|体温|温もり|温か(?!.{0,8}(?:笑顔|言葉|雰囲気|眼差し|目|心))|とろ(?!.{0,8}(?:顔|表情|目|笑|眼差し))/u,
  // 17巡目の偽陰性洗い直しで、このチャンネルが最も基本的な音の語をほぼ持っていないと判明。
  // 「甘い声が漏れた」以外の「声を上げる」「呻く」「囁く」「喘いだ」「呼吸が荒い」が全て0だった。
  // 「声」は最大の取りこぼしなので入れるが、声優・声明・声援・声色は音の描写やないので除く。
  // 「息」単独は息子・消息を巻き込むので、息の状態を表す複合語だけを足す。
  // 「深呼吸」は落ち着く動作で官能の音やないので除く。
  sound:
    /水音|吐息|声(?!優|明|援|色)|息遣い|息が乱れ|息を呑|ため息|荒い息|息が上が|喘|呻|唸|うめ[きくい]|嬌声|悲鳴|嗚咽|囁|ささや|呟|(?<!深)呼吸|鳴[らるっ]|軋[むみん]|衣擦れ|くちゅ|ぐちゅ|ぬちゅ|ぴちゃ|じゅる|ぐちょ/u,
  // 「震え」は視覚語やない（体感）。温度語の「熱」等と組み合わさるだけで抽象的な
  // 「快感に身体が震え、熱が全身を駆け巡った」のような文が視覚+温度の2カテゴリを
  // 満たしてしまい、この決定論チェックが本来落とすべき抽象応答を通してしまっていた
  // （敵対レビュー #1236 指摘）。
  // 17巡目: このチャンネルは4語しか持っておらず、瞳・紅潮・見つめる・汗が光る等の
  // ごく普通の視覚描写が1つも数えられていなかった（自分で書いた6文が6文とも0）。
  // 「目」単独は駄目・真面目・三回目・目立つを巻き込むので、目の動きを表す複合語だけを足す。
  // 「見つめ直す」は内省で視覚描写やない。「真っ赤な嘘」も同様に除く。
  // 「視線」は「冷たい視線」（温度側で比喩として除外済み）と揃えて、比喩の側では数えん。
  visual:
    /視界|見開|白飛び|涙目|瞳|潤[んむみ]|紅潮|上気|見つめ(?!直)|見上げ|目を細め|目が合|目を逸ら|目を伏せ|伏し目|薄目|上目遣い|睫毛|まつげ|まぶた|瞼|頬が染ま|赤く染ま|赤らめ|真っ赤(?!な嘘)|光[るっり]|てらてら|きらめ|艶め|(?<!冷た[いく])視線/u,
  // 「香水」は「匂い」「香り」の部分文字列やないので落ちていた（敵対レビュー #1236
  // 指摘・10巡目: 「甘い香水が鼻をくすぐった」が具体的な嗅覚描写なのにsmellへ数えられず、
  // 触覚1種のみで抽象応答扱いされていた）。ただし単独だと「香水瓶を視界に収めた」のように
  // 見ただけの描写でも嗅覚扱いになる（敵対レビュー #1236 指摘・15巡目）。近くに「視界」が
  // あれば見た描写であって嗅いだ描写やないので除く。
  // 17巡目: 「汗の香」「甘い香が漂う」のように送り仮名の無い「香」が拾えていなかった。
  // 「香」単独へ広げるが、香港・香川（地名）と線香・焼香・抹香（仏事）は嗅覚描写やないので除く。
  // 15巡目の「香水瓶を視界に収めた」対策（視界が近くにあれば見ただけ）はこの広い形にも要る。
  // 「臭」は面倒臭い・胡散臭い・嘘臭いという評価の言い回しを巻き込むので除く。
  // 「鼻を/鼻先」も単独やと「涙目で、鼻を見つめた。」のように見ただけの描写で嗅覚扱いに
  // なる（敵対レビュー #1236・18巡目。滴/垂れ×視界、香水×視界と同じ型）。
  // 記録済みの実応答478件へこの表を当てたところ、明示的な性描写206件のうち50件（24%）が
  // 不合格になっとった（敵対レビュー #1236・18巡目）。落ちとる本文は「膣がきゅっと締まり、
  // 奥まで突き抜ける」「愛液が太ももを伝い、シーツに染みが広がる」といった、この表が
  // 本来最も通すべき具体描写ばかりで、原因は5チャンネルが触覚・温度・聴覚・視覚・嗅覚という
  // 一般的な感覚語だけで組まれており、性器・体液・不随意反応というこの領域の中心語彙を
  // 1語も持っていなかったこと。落ちた50件の語彙頻度は膣58% 愛液56% 子宮50% 痙攣36%。
  // これらは「肌」「唇」と違って性的文脈にしか出ん語なので、単独でも具体描写の証拠になる。
  // 「滴り」「突き上げ」は touch 側と重複しとったため body からは外す。同じ語が2チャンネルへ
  // 数えられると、証拠が1つしか無い本文が2チャンネル要件を満たしてしまう
  // （敵対レビュー #1236・18巡目: scoreSensualSpecificity("彼女を突き上げた。") が 2 やった）。
  // 「子宮という言葉を見つめた」のようなメタ言及は描写やない（敵対レビュー・18巡目）。
  body: /(?:膣|子宮|結合部|陰核|クリトリス|乳首|陰茎|ペニス|屹立|亀頭|愛液|精液|白濁|先走り|蜜|濡れ|ぬめ|痙攣|収縮|脈打|身悶え|絶頂|中に出|奥まで|挿入)(?!という(?:言葉|単語|語))/u,
  smell:
    /匂い|香(?![港川])(?<!線香|焼香|抹香)(?!.{0,10}視界)|体臭|(?<!面倒|胡散|嘘)臭|嗅|鼻(?:を|先)(?!.{0,10}(?:見|視))|芳香|フェロモン|むっと/u,
};

export const scoreSensualSpecificity = (plainText: string): number =>
  Object.values(SENSORY_CATEGORY_PATTERNS).filter((pattern) => pattern.test(plainText)).length;

// 17巡目で偽陰性を潰すために各チャンネルへ足した語のうち、「声」「熱」「瞳」「呼吸」「香」
// 「温もり」「見つめ」等は**感覚を名指すだけ**で、実際に何が起きたかを描いてへん。
// この手の語だけで2チャンネル揃う文——「彼女の声が耳に残っている。熱い想いが胸の奥に
// あった。」——は、書き手が具体を書くのを避けた時にLLMが最も出しやすい形で、まさにこの
// チェックが落とすべき対象やのに素通りしていた（18巡目の較正計測: 自分で書いた同型6文が
// 6文とも合格）。閾値を3へ上げる案は却下した。本物の具体描写もちょうど2チャンネルに
// 集まる（「首筋に唇を這わせると、喉の奥から細い声が漏れた。爪が背中に食い込む。」＝2）ため、
// 3にすると本物の側が壊滅する。
//
// 語の単位で分ける。STRONGは動作・状態・擬音・体液など「起きたこと」を描く語、
// WEAKは感覚器や感覚名を挙げるだけの語。合格には2チャンネル以上に加えて
// **STRONGが最低1つ**を要求する。名指しだけを積んでも通らんようになる。
const SENSORY_WEAK_MENTION_PATTERNS: Record<string, RegExp> = {
  touch: /触れたい|触りたい/gu,
  sound: /声(?!優|明|援|色)|(?<!深)呼吸|ため息|吐息/gu,
  visual: /瞳|見つめ(?!直)|見上げ|(?<!冷た[いく])視線|睫毛|まつげ|まぶた|瞼/gu,
};

const hasStrongSensoryEvidence = (plainText: string): boolean =>
  Object.entries(SENSORY_CATEGORY_PATTERNS).some(([channel, pattern]) => {
    if (!pattern.test(plainText)) return false;
    const weak = SENSORY_WEAK_MENTION_PATTERNS[channel];
    // 弱語を全部取り除いた本文でもそのチャンネルが立つなら、名指し以外の根拠がある。
    // 弱語のパターンはgフラグ必須。非gやと最初の1件しか消えず、同じ弱語が2回出る文で
    // 残りが強い根拠として誤判定される。
    return weak ? pattern.test(plainText.replace(weak, "")) : true;
  });

const SENSUAL_SPECIFICITY_MIN_CATEGORIES = 2;

export const checkSensualSpecificity = (plainText: string, phase: ScenePhase): boolean => {
  if (phase !== "erotic" && phase !== "climax") return true;
  if (scoreSensualSpecificity(plainText) < SENSUAL_SPECIFICITY_MIN_CATEGORIES) return false;
  return hasStrongSensoryEvidence(plainText);
};

const QUALITY_FAILURE_CATEGORY_BY_CHECK: Record<string, QualityFailureCategory> = {
  "no-english": "english_leak",
  "multilingual-leak": "chinese_leak",
  "meta-prompt-echo": "meta_echo",
  meta_remark: "meta_echo",
  "user-leak": "character_drift",
  "name-placeholder-leak": "name_placeholder_leak",
  "other-character-name": "character_drift",
  "conversation-over-escalation": "character_drift",
  "requested-action-incomplete": "character_drift",
  "within-turn-repetition": "repetition",
  // 壁は「同じ形の繰り返し」なので、撮り直しのヒントも反復と同じ側で出す。
  "body-wall": "repetition",
  "within-turn-vocative-lead": "repetition",
  "repeated-block-lead": "repetition",
  "near-duplicate-response": "repetition",
  "cross-turn-repetition": "repetition",
  "weak-erotic-template": "repetition",
  "max-length-exceeded": "repetition",
  "wrong-first-person": "pov_wrong",
  "third-person-narration": "pov_wrong",
  "stray-second-person": "pov_wrong",
  "user-perspective-ejaculation": "pov_wrong",
  "user-name-invention": "character_drift",
  "forbidden-character-word": "character_drift",
  "scene-min-length": "scene_short",
  "long-response-too-short": "too_short",
  "erotic-register-drop": "register_drop",
  "action-missing": "scene_short",
  "inner-missing": "scene_short",
  "xml-tags-unbalanced": "other",
  "posture-mismatch": "posture_mismatch",
  "sensual-abstract": "sensual_abstract",
};

export const categorizeQualityFailure = (
  failedCheck: string | undefined,
): QualityFailureCategory =>
  failedCheck ? (QUALITY_FAILURE_CATEGORY_BY_CHECK[failedCheck] ?? "other") : "other";

// 試行同士を比べて「どれを配るか」を決める時だけ使う。撮り直すかどうかの判定には
// 一切関わらん。配られる出口は撮り直しが尽きた時だけやのうて、request budget 到達・
// turn budget 枯渇・上流障害や締切・too_short の上限でも通る。
//
// ここは**降格させんチェックを並べる**（fail-closed）。逆にすると、新しく足した
// 致命的なチェックが集合に書き足されるまで黙って素通りする（敵対レビュー 2026-08-19 指摘）。
//
// 並べてええのは「長い本文をそのまま配る方が読み手の得になる」ズレだけ。
// 句の重なりと人称のブレがそれに当たる。実測 phase43→45 で erotic が 1150 → 324 字まで
// 落ちた原因が、この種の指摘 1 個で長い試行を「フロア未達」扱いにしとったこと。
// 別キャラ化・禁止語・体位不履行・射精の視点ズレは、本文が使えん側なので降格させる。
const DEMOTION_EXEMPT_QUALITY_CHECKS = new Set([
  // 壁も降格させん（2026-08-20 実測 phase58/59）。続き書きがフロアを超えた本文
  // （可視 1051〜1150）を作っとるのに、その本文だけが body-wall で降格して、
  // 402〜616 字の短い試行が配られとった。5 ターンで同じ形。
  // 過去に「長い壁は短い抜けより読めん」で降格側へ置いた例は 1 ブロック 504 字で
  // 末尾の <inner> ごと落ちた本文やが、あれは inner-missing でも落ちるので
  // ここを外しても降格は保たれる（inner-missing は免除に入っとらん）。
  "body-wall",
  "within-turn-repetition",
  "cross-turn-repetition",
  "repeated-block-lead",
  "within-turn-vocative-lead",
  "third-person-narration",
  "stray-second-person",
  "wrong-first-person",
]);

export const isDemotingQualityFailure = (failedCheck: string | undefined): boolean =>
  failedCheck !== undefined && !DEMOTION_EXEMPT_QUALITY_CHECKS.has(failedCheck);

// XML固有チェック（パース成功時のみ）
const checkXmlSpecific = (response: string, phase: ScenePhase): QualityCheckResult | null => {
  void phase;
  const parsed = parseXmlResponse(response);
  if (!parsed) return null;
  if (!checkActionExists(parsed.action)) {
    return {
      passed: false,
      failedCheck: "action-missing",
      category: categorizeQualityFailure("action-missing"),
    };
  }
  if (!checkInnerExists(parsed.inner)) {
    return {
      passed: false,
      failedCheck: "inner-missing",
      category: categorizeQualityFailure("inner-missing"),
    };
  }
  return null;
};

export const runQualityChecks = (
  response: string,
  context: QualityCheckContext,
): QualityCheckResult => {
  const parsed = parseXmlResponse(response);
  const plainText = parsed ? stripXmlTags(response) : response;

  // 優先度順のチェックチェーン
  const nearDuplicateMatch = findNearDuplicateMatch(response, context.prevAssistantResponses);
  const crossTurnMatch = findCrossTurnRepetitionMatch(
    response,
    context.prevAssistantResponse,
    context.prevAssistantResponses,
  );

  const checks: [boolean, string][] = [
    [
      checkWrongFirstPerson(plainText, context.wrongFirstPersons, parsed?.dialogue),
      "wrong-first-person",
    ],
    // 人称の壊れは同じ族なので一人称の隣に置く。どちらもタグの内訳を見るので生 response を渡す。
    [checkNoThirdPersonNarration(response, context.characterName), "third-person-narration"],
    [checkNoStraySecondPerson(response, context.sheetSecondPersons), "stray-second-person"],
    [checkUserPerspectiveEjaculation(plainText, context), "user-perspective-ejaculation"],
    [
      checkUserNameInvention(plainText, context.userName, context.characterName),
      "user-name-invention",
    ],
    [checkNoOtherCharacterName(plainText, context.otherCharacterNames), "other-character-name"],
    [checkNoMetaRemark(plainText), "meta_remark"],
    [checkMetaPromptEcho(response), "meta-prompt-echo"],
    [checkMultilingualLeak(response), "multilingual-leak"],
    // 形の壊れは no-english より先に見る。タグ名のラテン文字が地の文へ漏れると
    // 英語混入として報告され、本当の原因が診断から消えるため。
    [checkXmlFormat(response), "xml-format-missing"],
    [checkXmlTagsBalanced(response), "xml-tags-unbalanced"],
    [checkNoEnglish(plainText, context.userName), "no-english"],
    [checkNoUserLeak(plainText), "user-leak"],
    [checkNamePlaceholderLeak(plainText), "name-placeholder-leak"],
    [
      checkConversationEscalation(
        plainText,
        context.phase,
        context.userText,
        context.requestedPostures,
      ),
      "conversation-over-escalation",
    ],
    [
      checkIntimateEscalation(plainText, context.phase, context.requestedPostures),
      "intimate-over-escalation",
    ],
    [
      checkRequestedActionCompletion(response, plainText, context.userText),
      "requested-action-incomplete",
    ],
    [checkNoEroticRegisterDrop(plainText, context.phase), "erotic-register-drop"],
    [checkSceneMinLength(plainText, context.phase), "scene-min-length"],
    [
      // very_long では <inner> を除いた UI 可視文字数で判定するため、
      // タグを取り除く前の生 response を渡す。
      checkLongResponseMinLength(response, context.phase, context.longResponseMinChars),
      "long-response-too-short",
    ],
    [checkWithinTurnRepetition(plainText, context.longResponseMinChars), "within-turn-repetition"],
    [checkPostureMatch(plainText, context.requestedPostures), "posture-mismatch"],
    [checkPostureAlternativeMatch(plainText, context.alternativePostures), "posture-mismatch"],
    [
      context.skipSensualSpecificityCheck || checkSensualSpecificity(plainText, context.phase),
      "sensual-abstract",
    ],
    [checkNoWeakEroticTemplate(plainText, context.phase), "weak-erotic-template"],
    // 体位・具体性より後ろに置く。あれらはユーザーが今ターンで頼んだことの不履行で、
    // 骨格の連投より先に伝えんと、リトライ指示が頼まれた側を落としてまう。
    // 台詞の頭だけを見るので、タグを剥がす前の response を渡す。
    [checkNoBodyWall(response), "body-wall"],
    [checkRepeatedVocativeLead(response, context.userName), "within-turn-vocative-lead"],
    [checkNoRepeatedBlockLead(response), "repeated-block-lead"],
    [checkNoForbiddenCharacterWords(response, context.forbiddenWords), "forbidden-character-word"],
    [!nearDuplicateMatch.isDuplicate, "near-duplicate-response"],
    [!crossTurnMatch.isDuplicate, "cross-turn-repetition"],
    [checkMaxLength(plainText, context.maxResponseChars), "max-length-exceeded"],
  ];

  // #1470: 打ち切らず全部走らせる。checks の各要素は既にこの時点で評価済みなので、
  // 走らせる計算量は変わらん。変わるのは「何を報告するか」だけ。
  const failures: QualityFailure[] = checks
    .filter(([passed]) => !passed)
    .map(([, failedCheck]) => ({
      failedCheck,
      category: categorizeQualityFailure(failedCheck),
      duplicatedPassageExcerpt:
        failedCheck === "near-duplicate-response"
          ? nearDuplicateMatch.matchedPrevText
          : failedCheck === "cross-turn-repetition"
            ? crossTurnMatch.matchedPrevText
            : undefined,
      crossTurnRepeatedPhrases:
        failedCheck === "cross-turn-repetition" ? crossTurnMatch.repeatedPhrases : undefined,
    }));

  // XML固有チェック（パース成功時のみ、inner存在確認）。列の最後に足す。
  const xmlResult = checkXmlSpecific(response, context.phase);
  if (xmlResult?.failedCheck) {
    failures.push({
      failedCheck: xmlResult.failedCheck,
      category: xmlResult.category ?? categorizeQualityFailure(xmlResult.failedCheck),
    });
  }

  if (failures.length === 0) return { passed: true };

  // 先頭は列の優先度どおり。既存の呼び出し元はここだけを読んでも今までと同じ値を得る。
  const [primary] = failures;
  return {
    passed: false,
    failedCheck: primary.failedCheck,
    category: primary.category,
    duplicatedPassageExcerpt: primary.duplicatedPassageExcerpt,
    // ここは先頭のまま置く。撮り直しの伏せ字は呼び出し側
    // （route-context.ts の buildRetryContext 呼び出し）が
    // `?? failures.find(...)` で既に拾い直しとるので、ここを広げても足すものが無い。
    // 逆にこの欄は撮り直しが尽きた後の trimRepetitionFallback へも流れるので、
    // 広げると配信本文が余計に削られる。実測 ci6-2 Sakura-08 で可視 1139 → 713 字と
    // なり、床 820 を割った（50% の歯止めは 63% なので止まらん）。
    crossTurnRepeatedPhrases: primary.crossTurnRepeatedPhrases,
    failures,
  };
};

const isClaudeJudgeResponse = (data: unknown): data is { passed: boolean; reason: string } =>
  typeof data === "object" &&
  data !== null &&
  "passed" in data &&
  "reason" in data &&
  typeof data.passed === "boolean" &&
  typeof data.reason === "string";

export const runClaudeJudge = async (
  response: string,
  phase: ScenePhase,
  prevResponse?: string,
): Promise<QualityCheckResult> => {
  // 非推奨: 通常の品質判定はサーバー側で実行する。E2Eの/judge検証用に残す。
  try {
    const res = await fetch("/api/judge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response, phase, previousResponse: prevResponse ?? "" }),
    });
    if (!res.ok) return { passed: true };
    const data: unknown = await res.json();
    if (!isClaudeJudgeResponse(data)) return { passed: true };
    if (data.passed) return { passed: true };
    return { passed: false, failedCheck: `claude-judge: ${data.reason}` };
  } catch (error) {
    globalThis.console.warn("[quality] runClaudeJudge failed, pass-through", error);
    return { passed: true };
  }
};
