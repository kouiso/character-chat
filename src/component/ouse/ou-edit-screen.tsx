import { useRef, useState } from "react";

import { ImageUp, Loader2, RefreshCw, Sparkles } from "lucide-react";

import { AuthenticatedImage } from "@/component/ui/authenticated-image";
import type { Character, CharacterInput } from "@/lib/api";
import { buildSystemPrompt, parseSystemPrompt } from "@/lib/prompt-builder";
import { cn } from "@/lib/utils";

import { sectionLabelClass, useAvatarUpload, wizardInputClass } from "../character/wizard-steps";

// D-5 キャラ編集: 作った子の修正。保存は「次の返事から」反映され進行中シーンは変えない。
// 会話カードの単一の真実は systemPrompt なので、parseSystemPrompt で分解し
// 編集後に buildSystemPrompt で再構築して updateCharacter に渡す。

interface OuEditScreenProps {
  character: Character;
  onSave: (input: CharacterInput) => void;
  onDelete: () => void;
  onBack: () => void;
}

// 「あなたとの関係」入力の下書き候補。クリックで入力欄を上書きするだけの叩き台。
const RELATIONSHIP_SUGGESTIONS = ["恋人", "人妻", "幼なじみ", "職場の先輩", "元カノ"] as const;
const GENDER_OPTIONS: { value: "female" | "male" | "other" | ""; label: string }[] = [
  { value: "", label: "未設定" },
  { value: "female", label: "女性" },
  { value: "male", label: "男性" },
  { value: "other", label: "その他" },
];

// Character 型には seed/visualPrompt は載らない（CharacterInput 専用フィールド）。
// 実行時に付いていれば保存時に維持したいので、型を壊さず optional 参照で拾う。
type CharacterWithImageMeta = Character & { seed?: number; visualPrompt?: string };

interface EditFields {
  name: string;
  gender: "female" | "male" | "other" | null;
  userGender: "female" | "male" | "other" | null;
  relationship: string;
  personality: string;
  eroticProfile: string;
  greeting: string;
  avatarKey: string | null;
}

const chipClass =
  "inline-flex min-h-11 min-w-11 items-center justify-center whitespace-nowrap rounded-full border border-[var(--hairline)] bg-[var(--night)]/35 px-3 py-1.5 font-sans-ui text-[11.5px] text-[var(--dim)] transition-colors hover:border-[var(--lamp-45)] hover:text-[var(--lamp)]";

const avatarActionClass =
  "flex min-h-11 min-w-11 items-center justify-center gap-1 whitespace-nowrap rounded-[15px] border px-3.5 py-1.5 font-sans-ui text-[11.5px] transition-colors";

const resolveName = (fieldsName: string, characterName: string): string =>
  fieldsName.trim() || characterName;

const resolveAvatar = (
  avatarKey: string | null,
  characterAvatar: string | null,
): string | undefined => avatarKey ?? characterAvatar ?? undefined;

const resolveGender = (fieldsGender: EditFields["gender"]) => fieldsGender ?? null;

const parseGenderValue = (value: string): "female" | "male" | "other" | null =>
  value === "female" || value === "male" || value === "other" ? value : null;

interface GenderSelectProps {
  label: string;
  value: "female" | "male" | "other" | null;
  onChange: (value: "female" | "male" | "other" | null) => void;
}

const GenderSelect = ({ label, value, onChange }: GenderSelectProps) => (
  <>
    <p className={sectionLabelClass}>{label}</p>
    <select
      value={value ?? ""}
      onChange={(e) => onChange(parseGenderValue(e.target.value))}
      aria-label={label}
      className={cn(wizardInputClass, "mb-[18px] appearance-none bg-transparent")}
    >
      {GENDER_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  </>
);

// 編集フィールドから updateCharacter に渡す CharacterInput を組み立てる。
// systemPrompt は buildSystemPrompt で再構築し、UI に無い appearance/custom/tags/
// userPersona/seed/visualPrompt は元キャラから維持して欠落させない。
const toCharacterInput = (character: Character, fields: EditFields): CharacterInput => {
  const parsed = parseSystemPrompt(character.systemPrompt ?? "");
  const imageMeta: CharacterWithImageMeta = character;
  const resolvedName = resolveName(fields.name, character.name);
  const trimmedErotic = fields.eroticProfile.trim();
  const systemPrompt = buildSystemPrompt({
    name: resolvedName,
    personality: fields.personality.trim(),
    appearance: parsed.appearance,
    scenario: fields.relationship.trim(),
    custom: parsed.custom,
    speechStyle: parsed.speechStyle,
    eroticProfile: trimmedErotic || undefined,
    // 画面に出さん節も渡し直す。渡さんと一度保存しただけで消える。キャラカードには
    // arc_* / sensory_focus / forbidden_words が入っとるので、消えた分だけ本文が痩せる。
    relationship: parsed.relationship,
    characterCard: parsed.characterCard,
  });

  return {
    name: resolvedName,
    avatar: resolveAvatar(fields.avatarKey, character.avatar),
    gender: resolveGender(fields.gender),
    systemPrompt,
    greeting: fields.greeting,
    tags: character.tags,
    userPersona: {
      name: character.userPersonaName,
      gender: resolveGender(fields.userGender),
      personality: character.userPersonaPersonality,
    },
    seed: imageMeta.seed,
    visualPrompt: imageMeta.visualPrompt,
  };
};

interface AvatarEditorProps {
  name: string;
  avatarSrc: string | null;
  isUploading: boolean;
  onPickFile: (file: File | undefined) => void;
}

const AvatarEditor = ({ name, avatarSrc, isUploading, onPickFile }: AvatarEditorProps) => {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const initial = name.trim()[0] ?? "?";
  // 認証フェッチ失敗時のフォールバックと avatarSrc 未設定時の表示は同じ頭文字プレースホルダーなので共有する
  const avatarFallback = (
    <div className="grid h-full w-full place-items-center font-narrative text-[28px] text-[var(--ghost)]">
      {initial}
    </div>
  );
  return (
    <div className="mb-5 flex items-center gap-4">
      <div className="relative h-[74px] w-[74px] shrink-0 overflow-hidden rounded-full border border-[var(--lamp-45)] bg-[var(--veil)]">
        {avatarSrc ? (
          <AuthenticatedImage
            src={avatarSrc}
            alt={name}
            className="h-full w-full object-cover"
            style={{ objectPosition: "50% 16%" }}
            fallback={avatarFallback}
          />
        ) : (
          avatarFallback
        )}
        {isUploading && (
          <div className="absolute inset-0 grid place-items-center bg-[var(--night)]/60">
            <Loader2 className="h-5 w-5 animate-spin text-[var(--lamp)]" />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-[7px]">
        {/* AI描き直しは専用ハンドラ未接続。主要アクションの見た目のまま押させると
            no-op で止まるので、他所（返事の設定シート）と同じ「近日対応」で示す */}
        <button
          type="button"
          disabled
          aria-disabled
          className={cn(
            avatarActionClass,
            "cursor-not-allowed border-[var(--hairline)] text-[var(--dim)] opacity-40",
          )}
        >
          <RefreshCw className="h-3 w-3" />
          AIで描き直す（近日対応）
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className={cn(avatarActionClass, "border-[var(--hairline)] text-[var(--dim)]")}
        >
          <ImageUp className="h-3 w-3" />
          画像をアップロード
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => onPickFile(e.target.files?.[0])}
        />
      </div>
    </div>
  );
};

const DeleteSection = ({ onDelete }: { onDelete: () => void }) => {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="border-t border-[var(--warn-border)] pt-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-sans-ui text-[12.5px] text-[var(--warn)]">この子とお別れする</div>
          <div className="mt-0.5 font-sans-ui text-[10.5px] text-[var(--ghost)]">
            会話・記憶・アルバムも消えます（取り消せません）
          </div>
        </div>
        {confirming ? (
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-[15px] border border-[var(--hairline)] px-3 py-2 font-sans-ui text-[11.5px] text-[var(--dim)]"
            >
              やめる
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-[15px] border border-[var(--warn-border)] bg-[var(--warn-bg)] px-3 py-2 font-sans-ui text-[11.5px] font-semibold text-[var(--warn)]"
            >
              本当に別れる
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="inline-flex min-h-11 min-w-11 items-center justify-center shrink-0 rounded-[15px] border border-[var(--warn-border)] px-4 py-2 font-sans-ui text-[11.5px] text-[var(--warn)]"
          >
            お別れ…
          </button>
        )}
      </div>
    </div>
  );
};

export const OuEditScreen = ({ character, onSave, onDelete, onBack }: OuEditScreenProps) => {
  // 破損データでも落ちないよう systemPrompt が無いケースを空文字に寄せる
  const parsed = parseSystemPrompt(character.systemPrompt ?? "");

  const [name, setName] = useState(character.name);
  const [gender, setGender] = useState<"female" | "male" | "other" | null>(
    character.gender ?? null,
  );
  const [userGender, setUserGender] = useState<"female" | "male" | "other" | null>(
    character.userPersonaGender ?? null,
  );
  // 「あなたとの関係」はカード上 scenario スロットに対応する自由記述
  const [relationship, setRelationship] = useState(parsed.scenario);
  const [personality, setPersonality] = useState(parsed.personality);
  const [eroticProfile, setEroticProfile] = useState(parsed.eroticProfile ?? "");
  const [greeting, setGreeting] = useState(character.greeting);
  const [hiddenOpen, setHiddenOpen] = useState(false);

  // アップロード成功時のみ avatarKey が入り、未操作なら既存 avatar を維持する
  const [uploadedKey, setUploadedKey] = useState<string | null>(null);
  const { previewDataUrl, isUploading, handleFileChange } = useAvatarUpload(setUploadedKey);

  const avatarSrc = previewDataUrl ?? character.avatar;
  // 秘めた面の折り畳み時サマリ（改行・空白を潰して先頭だけ見せる）
  const hiddenSummary = eroticProfile.replace(/\s+/gu, "").slice(0, 16);

  const handleSave = () =>
    onSave(
      toCharacterInput(character, {
        name,
        gender,
        userGender,
        relationship,
        personality,
        eroticProfile,
        greeting,
        avatarKey: uploadedKey,
      }),
    );

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {/* ヘッダー: ‹ もどる / {name} を編集 / 保存 */}
      <div className="flex items-center justify-between px-6 pb-1 pt-4">
        <button
          type="button"
          onClick={onBack}
          aria-label="もどる"
          className="inline-flex h-11 w-11 items-center justify-center rounded-full text-[18px] text-[var(--lamp)]"
        >
          ‹
        </button>
        <div className="font-narrative text-[16px] text-[var(--text)]">
          {name || "この子"} を編集
        </div>
        <button
          type="button"
          onClick={handleSave}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-3 font-sans-ui text-[12px] font-bold text-[var(--lamp)]"
        >
          保存
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-4 pt-4" style={{ scrollbarWidth: "none" }}>
        <AvatarEditor
          name={name}
          avatarSrc={avatarSrc}
          isUploading={isUploading}
          onPickFile={handleFileChange}
        />

        {/* なまえ */}
        <p className={sectionLabelClass}>なまえ</p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="なまえ"
          aria-label="なまえ"
          className={cn(wizardInputClass, "mb-[18px]")}
          maxLength={40}
        />

        <GenderSelect label="この子の性別" value={gender} onChange={setGender} />
        <GenderSelect
          label="あなたの性別（未設定でもOK）"
          value={userGender}
          onChange={setUserGender}
        />

        {/* あなたとの関係 */}
        <p className={sectionLabelClass}>あなたとの関係 — 自由に書ける</p>
        <input
          value={relationship}
          onChange={(e) => setRelationship(e.target.value)}
          placeholder="例: 同じマンションに住む年上の恋人"
          aria-label="あなたとの関係 — 自由に書ける"
          className={cn(wizardInputClass, "mb-[9px]")}
          maxLength={300}
        />
        <div className="mb-1.5 flex flex-wrap gap-[7px]">
          {RELATIONSHIP_SUGGESTIONS.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => setRelationship(chip)}
              className={chipClass}
            >
              {chip}
            </button>
          ))}
        </div>
        <p className="mb-[18px] font-sans-ui text-[10.5px] leading-5 text-[var(--ghost)]">
          チップは入力の下書きになるだけ。書き換え・書き足し自由（例: 週2で通う家庭教師）
        </p>

        {/* 性格・見た目 */}
        <p className={sectionLabelClass}>性格・見た目</p>
        <textarea
          value={personality}
          onChange={(e) => setPersonality(e.target.value)}
          placeholder="甘えん坊で、いつもタメ口。あなたの前でだけ声がすこし高くなる。"
          aria-label="性格・見た目"
          className={cn(wizardInputClass, "mb-2 min-h-[92px] resize-y leading-7")}
          maxLength={2000}
        />
        {/* ことば指示による書き直しは未接続。導線として控えめに残す */}
        <div className="mb-[18px] flex items-center justify-end gap-1 font-sans-ui text-[11px] text-[var(--dim)]">
          <Sparkles className="h-3 w-3 text-[var(--lamp)]" />
          ことばで指示して書き直す
        </div>

        {/* 秘めた面（折り畳み） */}
        <p className={sectionLabelClass}>秘めた面</p>
        {hiddenOpen ? (
          <textarea
            value={eroticProfile}
            onChange={(e) => setEroticProfile(e.target.value)}
            placeholder="独占欲が強い、甘噛みの癖…"
            aria-label="秘めた面"
            className={cn(wizardInputClass, "mb-[18px] min-h-[110px] resize-y leading-7")}
            maxLength={2000}
          />
        ) : (
          <button
            type="button"
            onClick={() => setHiddenOpen(true)}
            className="mb-[18px] flex w-full items-center justify-between rounded-[14px] border border-dashed border-[var(--hairline)] px-4 py-3 text-left"
          >
            <span className="font-sans-ui text-[12px] text-[var(--dim)]">
              {hiddenSummary ? `${hiddenSummary}…` : "秘めた面を書く"}
            </span>
            <span className="font-sans-ui text-[11px] text-[var(--ghost)]">開いて編集 ▸</span>
          </button>
        )}

        {/* はじまりのひと言 */}
        <p className={sectionLabelClass}>はじまりのひと言</p>
        <textarea
          value={greeting}
          onChange={(e) => setGreeting(e.target.value)}
          placeholder="「おかえりっ。今日もがんばったね……ねえ、こっちきて？」"
          aria-label="はじまりのひと言"
          className={cn(
            wizardInputClass,
            "mb-[22px] min-h-[84px] resize-y font-narrative text-[13px] italic leading-7",
          )}
          maxLength={1000}
        />

        <DeleteSection onDelete={onDelete} />
      </div>

      {/* フッター注記: 変更は次の返事から反映 */}
      <div className="shrink-0 border-t border-[var(--hairline)] bg-[var(--night)] px-6 pb-7 pt-3">
        <div className="rounded-[15px] border border-[var(--lamp-45)] bg-[var(--lamp-10)] px-4 py-3 font-sans-ui text-[11.5px] leading-6 text-[var(--dim)]">
          ✎ 変更は<b className="text-[var(--lamp)]">次の返事から</b>
          反映。進行中のシーンは変わりません。
        </div>
      </div>
    </div>
  );
};
