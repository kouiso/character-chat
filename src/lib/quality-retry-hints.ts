import { getMaxTokensForPhase, type ScenePhase } from "./scene-phase";

import type { PostureTerm } from "./posture-map";
import type { QualityFailureCategory } from "./quality-guard";

export interface QualityRetryContext {
  characterName?: string;
  firstPersonPronoun?: string;
  phase: ScenePhase;
  repeatedTokens?: string[];
  // #1470: 混入したラテン文字列。repeatedTokens は反復ヒント側が使うので、
  // english_leak が先頭以外で落ちた時に別枠が要る（反復した日本語の句を
  // 「混入した英単語」として名指ししてまうため）。
  englishTokens?: string[];
  // 前のターンからそのまま持ってきた句。どれを避ければええかを名指しするために使う。
  crossTurnRepeatedPhrases?: string[];
  duplicatedPassageExcerpt?: string;
  isRepeatSensualScene?: boolean;
  previousAssistantSamples?: string[];
  longResponseMinChars?: number;
  // #1225: 体位不一致のリトライで、指定された体位名を再掲するため
  requestedPostures?: PostureTerm[];
  // #1383: 世界観・シーン設定の一貫性リトライで、現在のシーン名を再掲するため
  sceneName?: string;
}

const formatList = (values: string[] | undefined, fallback: string): string => {
  const filtered = values?.map((value) => value.trim()).filter((value) => value.length > 0) ?? [];
  if (filtered.length === 0) return fallback;
  return filtered.slice(0, 8).join("、");
};

const buildCharacterAnchor = (context: QualityRetryContext): string => {
  const name = context.characterName ?? "キャラクター";
  const pronoun = context.firstPersonPronoun ?? "指定された一人称";
  const samples = formatList(context.previousAssistantSamples, "直近の口調");
  return `${name}として、外見・性格・関係性の設定に戻ってください。一人称は「${pronoun}」に固定し、${samples}から外れない自然な口調で書き直してください。`;
};

export const RETRY_LEAD = "キャラクター本人として、同じ場面を自然に書き直してください。";

// 前のターンから持ってきた句を名指しする。抜粋を渡すだけやと、モデルは自分が
// どこを再利用したのか分からんまま撮り直す（実測 2026-08-17 phase8: 3 回とも同じ句が戻った）。
const buildCrossTurnPhraseHint = (context: QualityRetryContext): string => {
  const phrases = context.crossTurnRepeatedPhrases
    ?.map((phrase) => phrase.trim())
    .filter((phrase) => phrase.length > 0)
    .slice(0, 6);
  if (!phrases || phrases.length === 0) return "";
  return `前のターンからそのまま持ってきた句は次の通りです。この句は一つも使わず、別の言い方で書いてください: ${phrases
    .map((phrase) => `「${phrase}」`)
    .join("、")}。`;
};

const buildRepetitionSceneShiftHint = (context: QualityRetryContext): string => {
  if (!context.duplicatedPassageExcerpt) return "";
  const excerptInstruction = `特に次の一節と同じ表現を繰り返さないでください:「${context.duplicatedPassageExcerpt}」`;
  if (!context.isRepeatSensualScene || (context.phase !== "erotic" && context.phase !== "climax")) {
    return excerptInstruction;
  }
  return `${excerptInstruction} 今回は引用箇所に寄った紋切り型の身体語彙・比喩・言い回しをなぞらず、呼吸、体温、声質、視界の変化など別の感覚へ焦点を移してください。前回と異なるテンポや感情の揺れで展開し、同じ場面の繰り返しに見えないよう意図的に変化させてください。`;
};

const QUALITY_RETRY_BUILDERS: Record<
  QualityFailureCategory,
  (context: QualityRetryContext) => string
> = {
  english_leak: (context) =>
    `${RETRY_LEAD}日本語だけで書き直してください。混入した英単語・アルファベット列（${formatList(
      context.englishTokens ?? context.repeatedTokens,
      "検出済み",
    )}）を使わず、台詞も地の文も厳密に日本語にしてください。`,
  chinese_leak: () =>
    `${RETRY_LEAD}日本語のかな・漢字だけで書き直してください。簡体字・繁体字・中国語表現を混ぜず、日本語として自然な語彙に置き換えてください。`,
  meta_echo: () =>
    `${RETRY_LEAD}アプリ側の説明や判定文を本文に出さず、世界内の出来事とキャラクターの反応だけを描写してください。`,
  character_drift: (context) =>
    `${RETRY_LEAD}${buildCharacterAnchor(
      context,
    )}相手を「ユーザー」と呼ばず、キャラクター本人の欲求・癖・距離感を保ってください。`,
  repetition: (context) =>
    `${RETRY_LEAD}反復している語句（${formatList(
      context.repeatedTokens,
      "同じ文・比喩・文末",
    )}）を避けてください。${buildCrossTurnPhraseHint(context)}${buildRepetitionSceneShiftHint(
      context,
    )}次の返答では新しい動詞、身体反応、情景イメージを使い、直近の表現をなぞらないでください。`,
  name_placeholder_leak: () =>
    `${RETRY_LEAD}ユーザーへの呼びかけに角括弧のプレースホルダーを使わないでください。「あなた」「君」などの二人称、または呼びかけを省略した自然な言い方にしてください。`,
  pov_wrong: (context) =>
    `${RETRY_LEAD}${context.characterName ?? "キャラクター"}として、一人称は「${
      context.firstPersonPronoun ?? "指定された一人称"
    }」だけを使うこと。自分を他の一人称や「${context.characterName ?? "キャラ"}」と呼ばず、ユーザーのことも三人称（彼/彼女/あいつ/人名）で呼ばない。キャラクター本人の内側から感覚・仕草・言葉を直接書き直してください。`,
  scene_short: (context) =>
    `${RETRY_LEAD}${context.phase}フェーズとして場面描写を厚くしてください。触覚・温度・音・匂い・視線のうち最低2種類を入れ、短い返答で終わらせないでください。`,
  too_short: (context) =>
    `キャラクター本人として、直前の返答は短すぎる。最低${
      context.longResponseMinChars ?? 600
    }字で、行為の経過・体の反応・喘ぎ声や台詞・相手とのやり取り・場所と空気を、複数段落で具体的に書き切れ。途中で要約や省略をしない。既に書いた文や段落をもう一度貼り付けて字数を埋めず、場面を先へ進めて新しい描写で埋めろ。`,
  register_drop: (context) =>
    `${RETRY_LEAD}${context.phase}フェーズの露骨な官能レジスターを保ってください。直前の身体状況を継続し、体内の温度、満たされる感覚、体液、息づかい、余韻を具体的に描写してください。`,
  posture_mismatch: (context) => {
    const postures = formatList(
      context.requestedPostures?.map((posture) => posture.label),
      "指定された体位",
    );
    return `${RETRY_LEAD}ユーザーが指定した体位（${postures}）をそのまま描写してください。別の体位や場所に置き換えず、その姿勢の支え・重心・触れている場所が分かる描写を入れてください。`;
  },
  sensual_abstract: () =>
    `${RETRY_LEAD}「気持ちいい」「快感」等の抽象語だけで終わらせず、触覚・体温・音・視覚・匂いのうち最低2種類を具体的な身体描写として書いてください。`,
  world_consistency: (context) => {
    const scene = context.sceneName ?? "設定されたシーン";
    return `${RETRY_LEAD}${buildCharacterAnchor(
      context,
    )} 相手のことも三人称（彼/彼女/あいつ/人名）で呼ばず、キャラクターの二人称で語りかけてください。現在のシーンは「${scene}」です。このシーンや関係性から逸脱する場所、乗り物、家具、時間帯、行動を修正し、シーン設定と矛盾しないように書き直してください。`;
  },
  other: () =>
    `${RETRY_LEAD}前回と異なる表現、具体的な身体描写、キャラ本人の声をそろえて書き直してください。`,
};

export function buildHintForCategory(
  category: QualityFailureCategory,
  context: QualityRetryContext,
): string {
  return QUALITY_RETRY_BUILDERS[category](context);
}

const getTokenUpperLimit = (baseMaxTokens: number): number => {
  const limits = [
    getMaxTokensForPhase("conversation"),
    getMaxTokensForPhase("intimate"),
    getMaxTokensForPhase("erotic"),
    getMaxTokensForPhase("climax"),
    getMaxTokensForPhase("afterglow"),
  ].sort((a, b) => a - b);
  // ベースと同値の上限だとboostが効かないため、厳密に上のフェーズ値を返す
  const nextHigher = limits.find((limit) => limit > baseMaxTokens);
  if (nextHigher) return nextHigher;
  // 最大フェーズ以上の場合は1.3倍まで許容
  return Math.ceil(baseMaxTokens * 1.3);
};

export function tunedParamsForCategory(
  category: QualityFailureCategory,
  base: { temperature: number; max_tokens: number },
): { temperature: number; max_tokens: number } {
  switch (category) {
    case "repetition":
      return { ...base, temperature: Math.min(1.0, Number((base.temperature + 0.1).toFixed(2))) };
    case "scene_short":
    case "too_short":
    case "register_drop":
      return {
        ...base,
        max_tokens: Math.min(Math.ceil(base.max_tokens * 1.3), getTokenUpperLimit(base.max_tokens)),
      };
    case "character_drift":
      return { ...base, temperature: Math.max(0.3, Number((base.temperature - 0.1).toFixed(2))) };
    default:
      return base;
  }
}
