import { z } from "zod/v4";

import {
  cleanCharacterInfoText,
  getCharacterInfoQualityIssues,
} from "../../../src/lib/character-info-quality";
import { visualMetaSchema } from "../../../src/schema";

export const generateCharacterResultSchema = z.object({
  name: z.string(),
  characterGender: z.enum(["female", "male", "other"]).default("female"),
  targetUserGender: z.enum(["male", "female", "any"]).default("male"),
  relationshipToUser: z.string().default("男ユーザー向けの成人女性キャラクター"),
  personality: z.string(),
  scenario: z.string(),
  greeting: z.string(),
  tags: z.array(z.string()),
  eroticProfile: z.string().max(2000).optional().default(""),
  // visualMeta は補助情報。enum 外の値が返っても本体まで捨てず、この項目だけ落とす
  visualMeta: visualMetaSchema.optional().catch(undefined),
});

export type GenerateCharacterResult = z.infer<typeof generateCharacterResultSchema>;

export type GenerateCharacterSelections = {
  types: string[];
  relations: string[];
  personalities: string[];
  bodyTypes: string[];
  freeText: string;
};

type PreviousCharacterResult = {
  name: string;
  personality: string;
  scenario: string;
  greeting: string;
  tags: string[];
  eroticProfile?: string;
};

export type CharacterGenerationMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export const CHARACTER_GENERATION_SYSTEM_PROMPT =
  `あなたは成人向けフィクションのキャラクター設定作家です。
ユーザーの属性指定から、会話でそのまま使える一人の成人キャラクターを作成してください。

出力は必ずJSONオブジェクトのみ。説明文、Markdown、注意書きは書かない。

品質ルール:
- キャラクター情報欄は「作品内の人物紹介」として自然な日本語で書く。
- フィールド本文は人物・関係・場面だけを書く。運用側の説明や出力形式の説明を混ぜない。
- personalityは、外見・性格・話し方・距離感を一つの人物像としてまとめる。箇条書きやテンプレ見出しを使わない。
- scenarioは、場所、時間帯、出会いのきっかけ、会話が始まる直前の空気を描く。ユーザーへの指示文にしない。
- greetingは、そのキャラ本人の第一声だけを書く。説明口調やメタ発言を避ける。
- eroticProfileは、性的な性格、エスカレーション、性交渉での振る舞い、事後の態度、特徴的な声を具体化する。ただし「以下5項目」などの指示文は書かない。
- 成人同士のNSFW設定は弱めない。ナンパ、合コン、性交渉の武勇伝、自慢、誘い、積極的な性格など、指定された成人向け要素はキャラ本人の欲望と口調として自然に書く。
- 急に諭す、受け流す、焦る、友達関係が壊れる不安、真面目な確認でキャラ性を薄めない。
- すべてのキャラクターは18歳以上の成人として扱う。未成年を示す語や年齢は出さない。

JSON shape:
{
  "name": "日本語の名前",
  "characterGender": "female | male | other",
  "targetUserGender": "male | female | any",
  "relationshipToUser": "キャラとユーザーの関係。例: 男キャラ + 男ユーザーの大学同級生友達",
  "personality": "200-400文字の自然な人物紹介",
  "scenario": "100-200文字の出会い・導入シーン",
  "greeting": "50-150文字の本人の第一声",
  "tags": ["3-7個の短い属性タグ"],
  "eroticProfile": "200-400文字の自然な性的特徴プロフィール",
  "visualMeta": {
    "hairColor": "black | brown | blonde | silver | white | blue | green | purple | red | pink",
    "hairStyle": "straight | wavy | curly | bob | ponytail | twintails | braid | messy",
    "hairLength": "short | medium | long | very_long",
    "eyeColor": "black | brown | blue | green | hazel | grey | amber | red | heterochromia",
    "skinTone": "pale | fair | olive | tanned | dark",
    "bodyType": "petite | slender | average | athletic | curvy | voluptuous",
    "breastSize": "flat | small | medium | large | huge",
    "heightBand": "petite | average | tall",
    "ageApparent": 18,
    "distinctiveMarks": ["danbooru_tag"],
    "defaultOutfit": ["danbooru_tag（実在する danbooru の衣装タグのみ。casual_top のような造語は保存時に捨てられる）"],
    "undressProgression": {}
  }
}` as const;

const BAD_EXAMPLE = `悪い例:
{
  "characterGender": "female",
  "targetUserGender": "male",
  "relationshipToUser": "アプリと利用者",
  "personality": "運用説明だけで人物像がない。",
  "scenario": "入力に従って返答する。",
  "greeting": "私は案内役です。",
  "eroticProfile": "性的特徴プロフィールを以下5項目で記述すること。"
}`;

const GOOD_EXAMPLE_RESULT: GenerateCharacterResult = {
  name: "白石 澪",
  characterGender: "female",
  targetUserGender: "male",
  relationshipToUser: "閉店間際のバーで出会う成人女性キャラクターと男ユーザー",
  personality:
    "澪は夜更けのバーで働く落ち着いた女性。淡いブラウンの長い髪をゆるくまとめ、相手の目を見て短く笑う癖がある。普段は丁寧で距離を保つが、気を許すと冗談を混ぜてからかい、声の温度だけで空気を甘く変えていく。",
  scenario:
    "雨の強い金曜の夜、閉店間際のバーにあなたが最後の客として入ってくる。澪は片付けの手を止め、濡れた肩先に視線を落としてから、カウンターの奥へ静かに招き入れる。",
  greeting:
    "「こんな時間にずぶ濡れで来るなんて……放っておけないでしょ。ほら、奥に座って。温かいもの、作ってあげる」",
  tags: ["バーテンダー", "お姉さん", "落ち着いた", "からかい上手"],
  eroticProfile:
    "澪はすぐに迫らず、視線や指先の距離で相手を焦らすタイプ。耳元で低く囁かれると呼吸が乱れ、首筋と腰に触れられると余裕が崩れやすい。高まるほど丁寧な口調が少し甘く崩れ、事後は照れを隠して世話を焼く。",
  visualMeta: {
    hairColor: "brown",
    hairStyle: "wavy",
    hairLength: "long",
    eyeColor: "brown",
    skinTone: "fair",
    bodyType: "slender",
    breastSize: "medium",
    heightBand: "average",
    ageApparent: 24,
    distinctiveMarks: ["soft_smile"],
    defaultOutfit: ["black_dress", "apron"],
    undressProgression: {},
  },
};

const GOOD_EXAMPLE = JSON.stringify(GOOD_EXAMPLE_RESULT);

export const buildGenerateCharacterPrompt = (
  selections: GenerateCharacterSelections,
  situation: string,
  details: string,
  previousResult: PreviousCharacterResult | undefined,
  feedback: string | undefined,
): string => {
  const allSelections = [
    ...selections.types,
    ...selections.relations,
    ...selections.personalities,
    ...selections.bodyTypes,
  ];
  const selectionText = allSelections.length > 0 ? allSelections.join("、") : "おまかせ";
  const situationText = situation || "おまかせ";
  const detailsText = details || "特になし";
  const freeText = selections.freeText || "";

  let userPrompt = `以下の条件で、会話にすぐ使える成人キャラクターを1人作成してください。

【選択された属性】${selectionText}
${freeText ? `【追加キーワード】${freeText}` : ""}
【シチュエーション】${situationText}
【こだわり・詳細】${detailsText}

必ず characterGender / targetUserGender / relationshipToUser を明示してください。
男キャラクター指定の場合は、ユーザーとの関係を自動で恋愛対象にせず、同性友達・同僚・先輩後輩など指定された立場を relationshipToUser に固定してください。
フィールド本文はキャラクター本人とシーンの情報だけにしてください。成人同士のNSFW要素は弱めず、指定された性的な自慢・誘い・欲望をキャラ本人の口調で自然に書いてください。アプリ運用や出力指示の説明は入れないでください。`;

  if (previousResult && feedback) {
    userPrompt += `

【前回の生成結果】
名前: ${previousResult.name}
性格・見た目: ${previousResult.personality}
シナリオ: ${previousResult.scenario}
挨拶: ${previousResult.greeting}
タグ: ${previousResult.tags.join("、")}
性的特徴: ${previousResult.eroticProfile ?? ""}

【ユーザーのフィードバック】${feedback}

上記のフィードバックを反映し、人物紹介として自然な文章に改善してください。`;
  }

  return userPrompt;
};

export const buildCharacterGenerationMessages = (
  selections: GenerateCharacterSelections,
  situation: string,
  details: string,
  previousResult: PreviousCharacterResult | undefined,
  feedback: string | undefined,
): CharacterGenerationMessage[] => [
  { role: "system", content: CHARACTER_GENERATION_SYSTEM_PROMPT },
  {
    role: "user",
    content: `${BAD_EXAMPLE}\n\n上の例の問題点を避け、次の良い例の文体でJSONを返してください。`,
  },
  { role: "assistant", content: GOOD_EXAMPLE },
  {
    role: "user",
    content: buildGenerateCharacterPrompt(selections, situation, details, previousResult, feedback),
  },
];

export const normalizeGeneratedCharacterResult = (
  result: GenerateCharacterResult,
): GenerateCharacterResult => ({
  ...result,
  personality: cleanCharacterInfoText(result.personality),
  scenario: cleanCharacterInfoText(result.scenario),
  greeting: cleanCharacterInfoText(result.greeting),
  eroticProfile: cleanCharacterInfoText(result.eroticProfile),
  tags: result.tags.map((tag) => cleanCharacterInfoText(tag)).filter((tag) => tag.length > 0),
});

export const parseCharacterJsonFromLLM = (content: string): GenerateCharacterResult | null => {
  const jsonMatch = content.match(/{[\S\s]*}/);
  if (!jsonMatch) return null;

  let jsonObj: unknown;
  try {
    jsonObj = JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }

  const parsed = generateCharacterResultSchema.safeParse(jsonObj);
  return parsed.success ? normalizeGeneratedCharacterResult(parsed.data) : null;
};

export const getGeneratedCharacterInfoIssues = (
  result: Pick<GenerateCharacterResult, "personality" | "scenario" | "greeting" | "eroticProfile">,
) => ({
  personality: getCharacterInfoQualityIssues(result.personality),
  scenario: getCharacterInfoQualityIssues(result.scenario),
  greeting: getCharacterInfoQualityIssues(result.greeting),
  eroticProfile: getCharacterInfoQualityIssues(result.eroticProfile),
});
