import { eq } from "drizzle-orm";

import {
  characterSceneDefaultTable,
  conversationSceneStateTable,
  sceneLocationTable,
} from "../../../src/schema";

import type { drizzle } from "drizzle-orm/d1";

type Database = ReturnType<typeof drizzle>;

// 会話の場面を更新する際に、過去の記憶・夢・話の中の場所を現在の舞台と誤認しないよう
// 周辺テキストに記憶系の語句が含まれていないか確認する。
const SCENE_MEMORY_CUES = ["思い出", "記憶", "夢", "昔", "子供の頃", "話を", "あった話"];

const isMemoryContextAround = (text: string, keyword: string, index: number): boolean => {
  const window = text.slice(Math.max(0, index - 30), index + keyword.length + 30);
  return SCENE_MEMORY_CUES.some((cue) => window.includes(cue));
};

export type SceneBackgroundPhase = "conversation" | "intimate" | "erotic" | "climax" | "afterglow";

// #444: 画像生成の背景は scene_state(直近更新) → character_default → keyword → none の順で解決する。
// scene_state は会話中に更新された舞台が最優先。未更新（新規会話）ならキャラ既定→prompt キーワード。

// scene_state の updatedAt がこの窓より古い場合は「未更新」とみなしフォールバックへ落とす。
const SCENE_STATE_FRESH_WINDOW_MS = 24 * 60 * 60 * 1000;

// 日本語/英語の場所表現 → SD 背景タグ。prompt 内で最後に出現したキーワードを優先する。
const KEYWORD_BACKGROUND_RULES: readonly { tag: string; keywords: readonly string[] }[] = [
  { tag: "bedroom, indoors", keywords: ["寝室", "ベッド", "bedroom", "bed"] },
  { tag: "living_room, indoors", keywords: ["ソファ", "sofa", "couch", "リビング"] },
  { tag: "alley, outdoors", keywords: ["路地裏", "路地", "alley", "back alley"] },
  { tag: "apartment_room, indoors", keywords: ["アパート", "部屋", "apartment", "room"] },
  { tag: "bar, indoors", keywords: ["バー", "居酒屋", "bar", "counter", "カウンター"] },
  { tag: "classroom, indoors", keywords: ["教室", "学校", "classroom", "school"] },
  { tag: "office, indoors", keywords: ["オフィス", "会社", "office", "desk"] },
  { tag: "bathroom, indoors", keywords: ["風呂", "浴室", "シャワー", "bath", "shower"] },
  { tag: "kitchen, indoors", keywords: ["台所", "キッチン", "kitchen"] },
  { tag: "love_hotel, indoors", keywords: ["ラブホ", "ホテル", "hotel"] },
  { tag: "outdoors", keywords: ["公園", "屋外", "野外", "outdoor", "outdoors", "park", "street"] },
  { tag: "car_interior", keywords: ["車内", "車の中", "car"] },
];

// erotic/climax/afterglow で屋外背景を使うには、ユーザーが明示的に野外プレイを求めている必要がある。
const EXPLICIT_OUTDOOR_CUES: readonly string[] = [
  "野外",
  "外で",
  "屋外",
  "青姦",
  "露出行為",
  "人目",
  "見られ",
  "バレそう",
  "野エッチ",
  "outdoor",
  "outside",
  "public",
  "alfresco",
  "exhibitionism",
  "exposed",
  "open air",
  "open-air",
  "outdoor play",
  "outdoor sex",
  "outside sex",
  "public sex",
  "public place",
  "public nudity",
  "野外プレイ",
  "野外セックス",
];

const OUTDOOR_BACKGROUND_TOKENS = new Set([
  "outdoors",
  "alley",
  "park",
  "beach",
  "street",
  "rooftop",
  "balcony",
]);

const normalize = (text: string): string => text.normalize("NFKC").toLowerCase();

// chat-image-prompt.ts が付ける [Nターン前] ユーザー: ... キャラ: ... マーカーから
// 全ユーザー発言を時系列順に抽出。キャラ側の幻覚を画像シーンに混ぜないため。
export const extractAllUserSegments = (prompt: string): string[] => {
  const matches = Array.from(prompt.matchAll(/ユーザー:\s*([\S\s]*?)(?=\n\s*[^\n]*キャラ:|$)/g));
  return matches.length > 0 ? matches.map((m) => m[1] ?? "") : [prompt];
};

export const isExplicitOutdoorPlayIntent = (text: string): boolean => {
  const normalized = normalize(text);
  return EXPLICIT_OUTDOOR_CUES.some((cue) => normalized.includes(cue));
};

export const isOutdoorBackgroundTag = (tag: string): boolean =>
  tag
    .split(",")
    .map((t) => t.trim())
    .some((t) => OUTDOOR_BACKGROUND_TOKENS.has(t));

// prompt 内の場所表現から推定。erotic/climax/afterglow では、最新のユーザー発言に
// 明示的な野外プレイの意図が無ければ屋外タグを返さない。
export const resolveBackgroundFromKeywords = (
  prompt: string,
  phase: SceneBackgroundPhase = "conversation",
): string | null => {
  const allUserSegments = extractAllUserSegments(prompt);
  // 会話フェーズでは過去の発言も参照する。Hシーンでは最新ユーザー発言だけを使い、
  // 古い屋外mentionが勝手に背景に上書きしないようにする。
  const userOnly =
    phase === "erotic" || phase === "climax" || phase === "afterglow"
      ? (allUserSegments[allUserSegments.length - 1] ?? prompt)
      : allUserSegments.join("\n");
  const isExplicitPhase = phase === "erotic" || phase === "climax" || phase === "afterglow";
  const scan = normalize(userOnly);
  let bestTag: string | null = null;
  let bestIndex = -1;
  for (const rule of KEYWORD_BACKGROUND_RULES) {
    for (const kw of rule.keywords) {
      const index = scan.lastIndexOf(normalize(kw));
      if (index !== -1 && index > bestIndex) {
        bestIndex = index;
        bestTag = rule.tag;
      }
    }
  }
  if (!bestTag) {
    return isExplicitPhase && isExplicitOutdoorPlayIntent(userOnly) ? "outdoors" : null;
  }
  if (!isExplicitPhase) return bestTag;
  if (!isOutdoorBackgroundTag(bestTag)) return bestTag;
  return isExplicitOutdoorPlayIntent(userOnly) ? bestTag : null;
};

export type BackgroundSource = "scene_state" | "character_default" | "keyword" | "none";

export type ResolvedBackground = {
  // SD に渡す背景タグ（none の場合は空文字）
  tag: string;
  source: BackgroundSource;
};

export type ResolveBackgroundInput = {
  conversationId?: string | null;
  characterId?: string | null;
  prompt: string;
  phase?: SceneBackgroundPhase;
  now?: number;
};

// 与えられた背景タグ/日本語場所名が屋外を表すかを判定する。
// 英語タグのほか、KEYWORD_BACKGROUND_RULES を使って日本語の場所名（scene_state 等）も判定する。
const isOutdoorResolvedBackground = (value: string): boolean => {
  if (isOutdoorBackgroundTag(value)) return true;
  const scan = normalize(value);
  return KEYWORD_BACKGROUND_RULES.some(
    (rule) =>
      isOutdoorBackgroundTag(rule.tag) && rule.keywords.some((kw) => scan.includes(normalize(kw))),
  );
};

// erotic/climax/afterglow で解決した背景が屋外の場合、最新ユーザー発言に明示的な野外プレイ意図が無ければ
// 室内に置き換える。野外でHさせるのはユーザーが明示的に求めた時だけにする。
const gateOutdoorBackgroundForExplicitPhase = (
  tag: string,
  prompt: string,
  phase: SceneBackgroundPhase,
): string => {
  const isExplicitPhase = phase === "erotic" || phase === "climax" || phase === "afterglow";
  if (!isExplicitPhase) return tag;
  if (!isOutdoorResolvedBackground(tag)) return tag;
  const allUserSegments = extractAllUserSegments(prompt);
  const latest = allUserSegments[allUserSegments.length - 1] ?? prompt;
  return isExplicitOutdoorPlayIntent(latest) ? tag : "indoors";
};

export const resolveSceneBackground = async (
  database: Database,
  input: ResolveBackgroundInput,
): Promise<ResolvedBackground> => {
  const now = input.now ?? Date.now();
  const phase = input.phase ?? "conversation";

  // 1) scene_state: 直近に更新された会話舞台があれば最優先。
  //    新しい background_tag カラムがあれば SD タグをそのまま使う。古い location 名のみの
  //    行は後方互換で屋外ガードを通す。
  if (input.conversationId) {
    const rows = await database
      .select({
        backgroundTag: conversationSceneStateTable.backgroundTag,
        locationId: conversationSceneStateTable.locationId,
        updatedAt: conversationSceneStateTable.updatedAt,
        locationName: sceneLocationTable.nameJp,
      })
      .from(conversationSceneStateTable)
      .leftJoin(
        sceneLocationTable,
        eq(conversationSceneStateTable.locationId, sceneLocationTable.id),
      )
      .where(eq(conversationSceneStateTable.conversationId, input.conversationId))
      .limit(1);
    const state = rows[0];
    if (state && now - state.updatedAt <= SCENE_STATE_FRESH_WINDOW_MS) {
      if (state.backgroundTag) {
        return {
          tag: gateOutdoorBackgroundForExplicitPhase(state.backgroundTag, input.prompt, phase),
          source: "scene_state",
        };
      }
      if (state.locationName) {
        return {
          tag: gateOutdoorBackgroundForExplicitPhase(state.locationName, input.prompt, phase),
          source: "scene_state",
        };
      }
    }
  }

  // 2) character_default: キャラ固有の既定背景。
  if (input.characterId) {
    const rows = await database
      .select({ backgroundTag: characterSceneDefaultTable.backgroundTag })
      .from(characterSceneDefaultTable)
      .where(eq(characterSceneDefaultTable.characterId, input.characterId))
      .limit(1);
    const tag = rows[0]?.backgroundTag;
    if (tag)
      return {
        tag: gateOutdoorBackgroundForExplicitPhase(tag, input.prompt, phase),
        source: "character_default",
      };
  }

  // 3) keyword: prompt 内の場所表現から推定。
  const keywordTag = resolveBackgroundFromKeywords(input.prompt, phase);
  if (keywordTag) return { tag: keywordTag, source: "keyword" };

  // 4) none
  return { tag: "", source: "none" };
};

// メッセージ保存時に会話の舞台を更新する。ユーザー/キャラ発言の中から最後に出現した
// 場所表現を拾い、記、記憶・夢・昔話ではないことを確認してから upsert する。
export const updateConversationSceneState = async (
  database: Database,
  conversationId: string,
  content: string,
  now = Date.now(),
): Promise<void> => {
  const normalized = normalize(content);
  let bestTag: string | null = null;
  let bestIndex = -1;
  let bestKeyword = "";

  for (const rule of KEYWORD_BACKGROUND_RULES) {
    for (const kw of rule.keywords) {
      const index = normalized.lastIndexOf(normalize(kw));
      if (index !== -1 && index > bestIndex) {
        bestIndex = index;
        bestTag = rule.tag;
        bestKeyword = kw;
      }
    }
  }

  if (!bestTag || bestIndex === -1) return;
  if (isMemoryContextAround(normalized, bestKeyword, bestIndex)) return;

  await database
    .insert(conversationSceneStateTable)
    .values({
      conversationId,
      backgroundTag: bestTag,
      updatedAt: now,
      undressLevel: "clothed",
      matePresent: 0,
    })
    .onConflictDoUpdate({
      target: conversationSceneStateTable.conversationId,
      set: { backgroundTag: bestTag, updatedAt: now },
    });
};
