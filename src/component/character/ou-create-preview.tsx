import { useRef, useState } from "react";

import { ChevronRight, ImageUp, Loader2, RefreshCw } from "lucide-react";

import type { GeneratedCharacter } from "@/lib/character-generator";

import {
  ctaPrimaryClass,
  sectionLabelClass,
  useAvatarUpload,
  wizardInputClass,
} from "./wizard-steps";

// A-4: 画像上にブラー背景で浮かせる操作ピル（回転・画像差し替え）
const pillClass =
  "flex items-center gap-1 rounded-full border border-[var(--lamp-30)] bg-[var(--night)]/55 px-2.5 py-1.5 font-sans-ui text-[11px] text-[var(--lamp)] shadow-[0_10px_30px_rgba(6,4,3,.28)] backdrop-blur-md transition-colors hover:border-[var(--lamp-45)] hover:text-[var(--text)] disabled:opacity-55";

interface HeroProps {
  result: GeneratedCharacter;
  avatar?: string;
  subtitle: string;
  isRegenerating: boolean;
  isUploading: boolean;
  onRegenerateFace: () => void;
  onPickFile: (file: File | undefined) => void;
}

// A-4: 名前・役どころは画像の上にグラデ幕でオーバーレイ、操作ピルは画像右下に浮かせる
const PreviewHero = ({
  result,
  avatar,
  subtitle,
  isRegenerating,
  isUploading,
  onRegenerateFace,
  onPickFile,
}: HeroProps) => {
  const fileRef = useRef<HTMLInputElement | null>(null);
  // preview 到達時に avatar が無い = サーバが顔だけ生成できなかった（本文は完成）＝ C-2 画像だけ失敗
  const faceFailed = !avatar && !isUploading;

  if (faceFailed) {
    // C-2: 本文はできあがり、顔だけ失敗。その場に留まるパネルで再試行できる（トーストにしない）
    return (
      <div className="flex h-[250px] w-full flex-col items-center justify-center gap-2 rounded-[22px] border border-dashed border-[var(--warn-border)] bg-[var(--warn-bg)] text-center">
        <span className="text-[18px] text-[var(--warn)]">◍</span>
        <span className="font-sans-ui text-[12px] text-[var(--warn-text)]">
          顔の生成に失敗しました
        </span>
        <span className="max-w-[80%] font-sans-ui text-[11px] leading-5 text-[var(--ghost)]">
          本文は保存できます。顔はあとから描き直せます。
        </span>
        <div className="mt-1 flex gap-2">
          <button
            type="button"
            onClick={onRegenerateFace}
            disabled={isRegenerating}
            className="flex items-center gap-1 rounded-full border border-[var(--lamp-45)] bg-[var(--lamp-22)] px-3.5 py-2 font-sans-ui text-[11px] text-[var(--lamp)] disabled:opacity-55"
          >
            {isRegenerating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            画像だけ再試行
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="rounded-full border border-[var(--hairline)] px-3.5 py-2 font-sans-ui text-[11px] text-[var(--dim)]"
          >
            自分の画像
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => onPickFile(e.target.files?.[0])}
        />
      </div>
    );
  }

  return (
    <div className="relative h-[250px] w-full overflow-hidden rounded-[22px] border border-[var(--hairline)] bg-[linear-gradient(160deg,var(--ink),var(--bar-bg))]">
      {avatar ? (
        <img
          src={avatar}
          alt={result.name}
          className="h-full w-full object-cover object-[50%_12%]"
        />
      ) : (
        <div className="grid h-full place-items-center font-sans-ui text-[12px] text-[var(--ghost)]">
          顔を思い浮かべています…
        </div>
      )}
      {isUploading && (
        <div className="absolute inset-0 grid place-items-center bg-[var(--night)]/60">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--lamp)]" />
        </div>
      )}

      {/* 読みやすさ用の下部グラデ幕 */}
      <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(10,7,6,.85),transparent_58%)]" />

      <div className="absolute bottom-3.5 left-4 right-28 flex min-w-0 flex-col gap-1">
        <p className="font-narrative text-[24px] font-medium leading-tight text-[var(--text)] [text-shadow:var(--read-shadow-soft)]">
          {result.name}
        </p>
        {subtitle && (
          <p className="font-sans-ui text-[12px] leading-none text-[var(--lamp-gold)]">
            {subtitle}
          </p>
        )}
      </div>

      <div className="absolute bottom-3 right-3 flex shrink-0 gap-1.5">
        <button
          type="button"
          className={pillClass}
          onClick={onRegenerateFace}
          disabled={isRegenerating}
        >
          {isRegenerating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          別の顔
        </button>
        <button type="button" className={pillClass} onClick={() => fileRef.current?.click()}>
          <ImageUp className="h-3.5 w-3.5" />
          自分の画像
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

const HiddenSection = ({ profile }: { profile: string }) => {
  const [open, setOpen] = useState(false);
  const summary = profile.replace(/\s+/gu, "").slice(0, 14);
  return (
    <div className="space-y-2">
      {/* 閉時は破線＝「タップで開く」余地があることの合図。開くと通常枠に戻す */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center justify-between rounded-[14px] border bg-[var(--veil)] px-3.5 py-3 text-left ${
          open ? "border-[var(--hairline)]" : "border-dashed border-[var(--hairline)]"
        }`}
      >
        <span className="font-sans-ui text-[12.5px] text-[var(--dim)]">
          秘めた面{summary && !open ? ` — ${summary}…` : ""}
        </span>
        <ChevronRight
          className={`h-4 w-4 text-[var(--lamp)] transition-transform ${open ? "rotate-90" : ""}`}
        />
      </button>
      {open && (
        <p className="whitespace-pre-line rounded-[14px] border border-[var(--hairline)] bg-[var(--veil)] px-3.5 py-3 font-sans-ui text-[13px] leading-7 text-[var(--dim)]">
          {profile || "未設定"}
        </p>
      )}
    </div>
  );
};

interface OuCreatePreviewProps {
  result: GeneratedCharacter;
  onRegenerateFull: (feedback: string) => void;
  onRegenerateFace: () => void;
  onManualAvatarOverride: (dataUrlOrKey: string) => void;
  onSaveDirectly: () => void;
  onBack: () => void;
  isRegenerating: boolean;
}

// 「細かく編集」は A-4 のヘッダー右リンク（ou-create-flow.tsx）に移設済み。
// 下部の主CTAは「この子に会いに行く」1本に絞る（spec のヒエラルキーに合わせる）。
export const OuCreatePreview = ({
  result,
  onRegenerateFull,
  onRegenerateFace,
  onManualAvatarOverride,
  onSaveDirectly,
  isRegenerating,
}: OuCreatePreviewProps) => {
  const [feedback, setFeedback] = useState("");
  const { previewDataUrl, isUploading, handleFileChange } = useAvatarUpload((key) => {
    if (key) onManualAvatarOverride(key);
  });
  const avatar = previewDataUrl || result.avatar;
  const tags = result.tags ?? [];

  return (
    <div className="space-y-5">
      <PreviewHero
        result={result}
        avatar={avatar}
        subtitle={tags.slice(0, 2).join(" ・ ")}
        isRegenerating={isRegenerating}
        isUploading={isUploading}
        onRegenerateFace={onRegenerateFace}
        onPickFile={handleFileChange}
      />

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {/* 生成属性タグは金の強調枠（design A-4）で他の中立チップと区別する */}
          {tags.map((tag, i) => (
            <span
              key={`${tag}-${i}`}
              className="rounded-full border border-[var(--lamp-45)] bg-[var(--night)]/70 px-3 py-1 font-sans-ui text-[11px] font-medium text-[var(--lamp-gold)] shadow-[inset_0_0_0_1px_var(--lamp-10)]"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      <div>
        <p className={sectionLabelClass}>性格・見た目</p>
        <p className="font-sans-ui text-[13.5px] leading-7 text-[var(--dim)]">
          {result.personality}
        </p>
      </div>

      <div>
        <p className={sectionLabelClass}>シナリオ</p>
        <p className="font-sans-ui text-[13.5px] leading-7 text-[var(--dim)]">{result.scenario}</p>
      </div>

      <div>
        <p className={sectionLabelClass}>はじまりのひと言</p>
        <p className="font-narrative text-[15px] italic leading-8 text-[var(--text)]">
          「{result.greeting}」
        </p>
      </div>

      <HiddenSection profile={result.eroticProfile ?? ""} />

      {/* ことばで直す（部分再生成） */}
      <div>
        <p className={sectionLabelClass}>気になるところを、ことばで直す</p>
        <div className="flex items-center gap-2">
          <input
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="例: もっと強気に、呼び方は「先生」…"
            className={wizardInputClass}
            maxLength={500}
          />
          <button
            type="button"
            disabled={!feedback.trim() || isRegenerating}
            onClick={() => {
              onRegenerateFull(feedback);
              setFeedback("");
            }}
            className="flex shrink-0 items-center gap-1 rounded-full border border-[var(--lamp-45)] bg-[var(--lamp-10)] px-4 py-2.5 font-sans-ui text-[12.5px] text-[var(--lamp)] disabled:opacity-55"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            直す
          </button>
        </div>
      </div>

      <div className="pt-1">
        <button type="button" className={ctaPrimaryClass} onClick={onSaveDirectly}>
          この子に会いに行く →
        </button>
      </div>
    </div>
  );
};
