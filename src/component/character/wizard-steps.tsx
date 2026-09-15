import { useRef, useState } from "react";

import { ChevronLeft, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { AuthenticatedImage } from "@/component/ui/authenticated-image";
import { apiFetch } from "@/lib/api";
import {
  CHIP_CATEGORIES,
  SITUATION_PRESETS,
  type CharacterSelections,
} from "@/lib/character-generator";
import { cn } from "@/lib/utils";

// ── 共有デザイントークン（Create Flow Explorations 準拠 : 夜×燈のゴールド） ──
// ラベルは Zen Kaku Gothic New（font-sans-ui）で字間広め・くすんだ色
export const sectionLabelClass =
  "mb-2 font-sans-ui text-[11px] font-medium tracking-[0.2em] text-[var(--ghost)]";
export const goldLabelClass =
  "mb-2 font-sans-ui text-[11px] font-medium tracking-[0.24em] text-[var(--lamp)]";
export const wizardInputClass =
  "min-h-[44px] w-full rounded-[14px] border border-[var(--hairline)] bg-[var(--veil)] px-3.5 py-2.5 font-sans-ui text-[13.5px] leading-6 tracking-[0.02em] text-[var(--text)] outline-none placeholder:text-[var(--ghost)] focus:border-[var(--lamp-45)] focus:ring-2 focus:ring-[var(--lamp-10)]";
// 選択チップは design どおり“燈のべた塗り”、未選択は細線
export const wizardChipClass = (selected: boolean): string =>
  cn(
    "min-h-[44px] rounded-full border px-3.5 py-1.5 font-sans-ui text-[12.5px] tracking-[0.04em] transition-colors",
    selected
      ? "border-transparent bg-[var(--lamp)] text-[var(--night)] shadow-[0_6px_20px_-8px_var(--lamp-55)]"
      : "border-[var(--hairline)] bg-[var(--night)]/35 text-[var(--dim)] hover:bg-[var(--lamp-7)] hover:text-[var(--text)]",
  );
// インラインの小さめ丸ボタン（別の顔・直す 等）
export const wizardPrimaryButtonClass =
  "min-h-[44px] rounded-full bg-[var(--lamp)] px-5 font-narrative text-[14px] font-semibold tracking-[0.14em] text-[var(--night)] shadow-[0_14px_34px_-12px_var(--lamp-55)] hover:bg-[var(--lamp)]/90";
export const wizardOutlineButtonClass =
  "min-h-[44px] rounded-full border-[var(--hairline)] bg-[var(--night)]/30 font-sans-ui text-[var(--dim)] hover:bg-[var(--lamp-7)] hover:text-[var(--lamp)]";
// 画面下部の全幅 CTA（燈のグラデーション）。角度は design 通り 145deg（他の送信ボタンと統一）
export const ctaPrimaryClass =
  "flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[linear-gradient(145deg,var(--gold-cta),var(--lamp-gold))] font-narrative text-[15px] font-semibold tracking-[0.14em] text-[var(--on-lamp)] shadow-[0_16px_38px_-14px_var(--lamp-55)] transition active:scale-[0.99] disabled:opacity-55";

// ── 3ステップの進捗バー ─────────────────────────────────────────────────
export const StepProgress = ({ step }: { step: 1 | 2 | 3 }) => (
  <div className="mb-4 flex items-center gap-2">
    <div className="flex flex-1 gap-1.5">
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={cn(
            "h-[3px] flex-1 rounded-full transition-colors",
            i <= step ? "bg-[var(--lamp)]" : "bg-[var(--hairline)]",
          )}
        />
      ))}
    </div>
    <span className="font-sans-ui text-[11px] tracking-[0.12em] text-[var(--ghost)]">{step}/3</span>
  </div>
);

// ── Step 1: 属性チップ選択（こだわってつくる） ───────────────────────────

interface ChipSelectProps {
  label: string;
  chips: readonly string[];
  selected: string[];
  onToggle: (chip: string) => void;
}

const ChipSelect = ({ label, chips, selected, onToggle }: ChipSelectProps) => (
  <div>
    <p className={sectionLabelClass}>{label}</p>
    <div className="flex flex-wrap gap-2">
      {chips.map((chip) => {
        const isSelected = selected.includes(chip);
        return (
          <button
            key={chip}
            type="button"
            onClick={() => onToggle(chip)}
            className={wizardChipClass(isSelected)}
          >
            {chip}
          </button>
        );
      })}
    </div>
  </div>
);

export interface WizardStep1Props {
  selections: CharacterSelections;
  onUpdate: (patch: Partial<CharacterSelections>) => void;
  onNext: () => void;
}

export const WizardStep1 = ({ selections, onUpdate, onNext }: WizardStep1Props) => {
  const toggleChip = (key: keyof CharacterSelections, chip: string) => {
    if (key === "freeText") return;
    const current = selections[key];
    const next = current.includes(chip) ? current.filter((c) => c !== chip) : [...current, chip];
    onUpdate({ [key]: next });
  };

  return (
    <div className="space-y-5">
      <StepProgress step={1} />
      {CHIP_CATEGORIES.map((cat) => (
        <ChipSelect
          key={cat.key}
          label={cat.label}
          chips={cat.chips}
          selected={selections[cat.key]}
          onToggle={(chip) => toggleChip(cat.key, chip)}
        />
      ))}

      <div>
        <p className={sectionLabelClass}>その他（自由入力）</p>
        <input
          type="text"
          value={selections.freeText}
          onChange={(e) => onUpdate({ freeText: e.target.value })}
          placeholder="例: 眼鏡、関西弁、タトゥー…"
          className={wizardInputClass}
          maxLength={500}
        />
      </div>

      <button type="button" onClick={onNext} className={ctaPrimaryClass}>
        つぎへ — 場面をえらぶ
      </button>
    </div>
  );
};

// ── Step 2: シチュエーション & こだわり & 画像 ───────────────────────────

export interface WizardStep2Props {
  situation: string;
  details: string;
  imageMode: "ai" | "upload";
  uploadedImageDataUrl: string | null;
  onImageModeChange: (mode: "ai" | "upload") => void;
  onUploadedImageChange: (dataUrl: string | null) => void;
  onSituationChange: (v: string) => void;
  onDetailsChange: (v: string) => void;
  onBack: () => void;
  onGenerate: () => void;
  isGenerating: boolean;
}

const uploadAvatarToR2 = async (dataUrl: string, mimeType: string): Promise<string> => {
  const res = await apiFetch("/api/avatar/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: dataUrl, mimeType }),
  });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  const json: { avatarKey: string } = await res.json();
  return json.avatarKey;
};

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("unexpected result type"));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

export const useAvatarUpload = (onKeyChange: (key: string | null) => void) => {
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const handleFileChange = (file: File | undefined) => {
    if (!file) {
      onKeyChange(null);
      setPreviewDataUrl(null);
      return;
    }
    setIsUploading(true);
    readFileAsDataUrl(file)
      .then(async (dataUrl) => {
        setPreviewDataUrl(dataUrl);
        const key = await uploadAvatarToR2(dataUrl, file.type);
        onKeyChange(key);
      })
      .catch(() => {
        toast.error("画像のアップロードに失敗しました。もう一度お試しください。");
        onKeyChange(null);
        setPreviewDataUrl(null);
      })
      .finally(() => setIsUploading(false));
  };

  return { previewDataUrl, isUploading, handleFileChange };
};

const imageToggleClass = (active: boolean): string =>
  cn(
    "min-h-[44px] flex-1 rounded-full border px-4 py-2.5 font-sans-ui text-[13px] tracking-[0.06em] transition-colors",
    active
      ? "border-transparent bg-[var(--lamp)] text-[var(--night)]"
      : "border-[var(--hairline)] bg-[var(--night)]/30 text-[var(--dim)] hover:text-[var(--text)]",
  );

export const WizardStep2 = ({
  situation,
  details,
  imageMode,
  uploadedImageDataUrl,
  onImageModeChange,
  onUploadedImageChange,
  onSituationChange,
  onDetailsChange,
  onBack,
  onGenerate,
  isGenerating,
}: WizardStep2Props) => {
  // 親stateの値がプリセットに含まれていなければカスタム入力モードで初期化
  const isPreset = SITUATION_PRESETS.some((p) => p === situation);
  const [customSituation, setCustomSituation] = useState(!isPreset && situation.length > 0);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const {
    previewDataUrl,
    isUploading: isUploadingAvatar,
    handleFileChange,
  } = useAvatarUpload(onUploadedImageChange);

  return (
    <div className="space-y-5">
      <StepProgress step={2} />

      <button
        type="button"
        onClick={onBack}
        className="inline-flex min-h-[44px] min-w-[44px] items-center gap-1 rounded-md px-2 font-sans-ui text-[12px] text-[var(--dim)] hover:text-[var(--lamp)]"
      >
        <ChevronLeft className="h-4 w-4" />
        もどる
      </button>

      <div>
        <p className={sectionLabelClass}>出会いのシチュエーション</p>
        <div className="mb-2 flex flex-wrap gap-2">
          {SITUATION_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => {
                onSituationChange(preset);
                setCustomSituation(false);
              }}
              className={wizardChipClass(situation === preset && !customSituation)}
            >
              {preset}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setCustomSituation(true);
              onSituationChange("");
            }}
            className={cn(
              "rounded-full border border-dashed px-3.5 py-1.5 font-sans-ui text-[12.5px] tracking-[0.04em] transition-colors",
              customSituation
                ? "border-[var(--lamp-55)] text-[var(--lamp)]"
                : "border-[var(--hairline)] text-[var(--dim)] hover:text-[var(--text)]",
            )}
          >
            自由に入力…
          </button>
        </div>
        {customSituation && (
          <input
            type="text"
            value={situation}
            onChange={(e) => onSituationChange(e.target.value)}
            placeholder="好きなシチュエーションを入力…"
            className={wizardInputClass}
            maxLength={500}
            autoFocus
          />
        )}
        <p className="mt-2 font-sans-ui text-[11.5px] leading-5 text-[var(--ghost)]">
          物語を貼り付けたい場合は下の「こだわり」にそのまま貼ってOK
        </p>
      </div>

      <div>
        <p className={sectionLabelClass}>こだわりポイント（任意）</p>
        <textarea
          value={details}
          onChange={(e) => onDetailsChange(e.target.value)}
          placeholder={
            "例: 最初は嫌がるけど途中から積極的になる、方言で喋る、Mっ気がある、シナリオの貼り付け…など何でもOK"
          }
          className={cn(wizardInputClass, "min-h-[104px] resize-y")}
          maxLength={1000}
        />
      </div>

      <div>
        <p className={sectionLabelClass}>画像</p>
        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={() => onImageModeChange("ai")}
            className={imageToggleClass(imageMode === "ai")}
          >
            AIで生成
          </button>
          <button
            type="button"
            onClick={() => onImageModeChange("upload")}
            className={imageToggleClass(imageMode === "upload")}
          >
            アップロード
          </button>
        </div>
        <p className="mt-2 font-sans-ui text-[11.5px] leading-5 text-[var(--ghost)]">
          生成結果に合わせて顔も描かれます。あとから何度でも差し替え可。
        </p>
        {imageMode === "upload" && (
          <div className="mt-3 space-y-3 rounded-[16px] border border-[var(--hairline)] bg-[var(--veil)] p-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => handleFileChange(e.target.files?.[0])}
              className="w-full font-sans-ui text-[12px] text-[var(--dim)] file:mr-3 file:rounded-full file:border-0 file:bg-[var(--lamp-10)] file:px-3 file:py-1.5 file:text-[var(--lamp)]"
            />
            {isUploadingAvatar ? (
              <div className="flex h-12 items-center gap-2 font-sans-ui text-sm text-[var(--dim)]">
                <Loader2 className="h-4 w-4 animate-spin" />
                アップロード中…
              </div>
            ) : previewDataUrl ? (
              <img
                src={previewDataUrl}
                alt="アップロード画像プレビュー"
                className="max-h-48 rounded-[16px] border border-[var(--hairline)] object-contain shadow-[var(--read-shadow-soft)]"
              />
            ) : uploadedImageDataUrl ? (
              // 素材管理から持ってきた画像（#823）。R2 キーのこともあるので
              // 生の img ではなく認証付きで取りに行く。
              <AuthenticatedImage
                src={uploadedImageDataUrl}
                alt="選んだ素材のプレビュー"
                className="max-h-48 rounded-[16px] border border-[var(--hairline)] object-contain shadow-[var(--read-shadow-soft)]"
              />
            ) : null}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onGenerate}
        disabled={isGenerating}
        className={ctaPrimaryClass}
      >
        {isGenerating ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            生成中…
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4" />
            AIで生成する
          </>
        )}
      </button>
    </div>
  );
};
