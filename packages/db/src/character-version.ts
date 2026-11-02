// キャラの版（character_version）の契約。content は保存・検索の正であり、
// character 表の name/systemPrompt/greeting/tags は互換ミラーとして同時更新する。
// 会話は character_version_id で版を固定し、後からの編集が過去会話の人格を変えんようにする。
import { z } from "zod";

export const CHARACTER_CONTENT_SCHEMA_VERSION = 1;

// API 入力の上限（PBI追記の自社初期上限）。storedCharacterContentSchema 側は旧データの長い
// systemPrompt をそのまま snapshot できるよう人格系の max だけ外す。新規・編集はこちらを通す。
export const characterContentSchema = z.object({
  name: z.string().trim().min(1).max(80),
  bio: z.string().trim().max(500).default(""),
  personality: z.string().trim().min(1).max(2000),
  speechStyle: z.string().trim().min(1).max(1000),
  appearance: z.string().trim().max(4000).default(""),
  background: z.string().trim().max(4000).default(""),
  worldSetting: z.string().trim().max(4000).default(""),
  prologue: z.string().trim().max(4000).default(""),
  greeting: z.string().trim().min(1).max(2000),
  privateNotes: z.string().trim().max(4000).default(""),
  tags: z.array(z.string().trim().min(1).max(30)).max(5).default([]),
  voiceRef: z.string().trim().max(200).nullable().default(null),
  avatarRef: z.string().trim().max(500).nullable().default(null),
  visibility: z.enum(["private", "shared", "public"]).default("private"),
});

// 保存データの検証。上限は新規入力の契約であって、既存 character の長い systemPrompt を
// snapshot した版は実データを削らんため人格系の長さを緩める。
export const storedCharacterContentSchema = characterContentSchema.extend({
  name: z.string().min(1),
  personality: z.string().min(1),
  speechStyle: z.string(),
  greeting: z.string().min(1),
  tags: z.array(z.string()),
  avatarRef: z.string().nullable(),
  legacyReconstructed: z.literal(true).optional(),
});

export type CharacterContent = z.infer<typeof storedCharacterContentSchema>;

// 移行前の履歴は復元できないため、現存する設定の再構成版であることを残す。
export const legacyCharacterContent = (row: {
  name: string;
  systemPrompt: string;
  greeting: string;
  tags: string[];
  avatar: string | null;
}): CharacterContent => ({
  name: row.name,
  bio: "",
  personality: row.systemPrompt,
  speechStyle: "",
  legacyReconstructed: true,
  appearance: "",
  background: "",
  worldSetting: "",
  prologue: "",
  greeting: row.greeting,
  privateNotes: "",
  tags: row.tags,
  voiceRef: null,
  avatarRef: row.avatar,
  visibility: "private",
});

// contentJson の正規形。キー順を固定して同内容は同じハッシュになるようにする
//（同内容の再送で版を増やさん契約の判定に使う）。
export const canonicalContentJson = (content: CharacterContent): string =>
  JSON.stringify(content, Object.keys(content).sort() as (keyof CharacterContent)[]);

export const characterContentHash = async (content: CharacterContent): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalContentJson(content)),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const section = (label: string, text: string) => (text === "" ? "" : "【" + label + "】\n" + text);

// engine が使う CharacterSheet.systemPrompt への写像。版の保存フィールドは分離したまま、
// モデルへ渡す指示だけここで合成する（二重保存にせんため毎回ここで作る）。
export const composeSystemPrompt = (content: CharacterContent): string =>
  content.legacyReconstructed
    ? content.personality
    : [
        section("人格", content.personality),
        section("口調・話し方", content.speechStyle),
        section("外見", content.appearance),
        section("背景", content.background),
        section("世界設定", content.worldSetting),
        section("プロローグ", content.prologue),
        section("演出メモ", content.privateNotes),
      ]
        .filter((text) => text !== "")
        .join("\n\n");
