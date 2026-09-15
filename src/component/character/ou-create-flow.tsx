import { useEffect, useState, type ReactNode } from "react";

import { ChevronLeft } from "lucide-react";

import { Dialog, DialogContent, DialogTitle } from "@/component/ui/dialog";
import {
  generateCharacter,
  type CharacterSelections,
  type GeneratedCharacter,
} from "@/lib/character-generator";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/store/settings-store";

import { OuCreateAuto } from "./ou-create-auto";
import { OuCreateEntry } from "./ou-create-entry";
import { OuCreatePreview } from "./ou-create-preview";
import { OuCreateScenario } from "./ou-create-scenario";
import {
  WizardStep1,
  WizardStep2,
  ctaPrimaryClass,
  wizardOutlineButtonClass,
} from "./wizard-steps";

type FlowStep =
  | "entry"
  | "auto"
  | "scenario"
  | "wizard-step1"
  | "wizard-step2"
  | "generating"
  | "preview"
  | "error";

interface CreateFlowProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaveDirectly: (result: GeneratedCharacter) => void;
  onEditAndSave: (result: GeneratedCharacter) => void;
  // 素材管理から選んで来た画像。開いた時点でアップロード側に寄せる（#823）
  initialUploadedImage?: string | null;
}

interface GenerateRequest {
  selections: CharacterSelections;
  situation: string;
  details: string;
}

const initialSelections: CharacterSelections = {
  types: [],
  relations: [],
  personalities: [],
  bodyTypes: [],
  freeText: "",
};

// 生成中の段階（design C-1 : SSEで項目ごとに届く の見立て）
const genStages = ["なまえ", "性格・見た目", "シナリオ", "はじまりのひと言"] as const;

const stepTitle: Record<FlowStep, string> = {
  entry: "あたらしい相手をつくる",
  auto: "おまかせでつくる",
  scenario: "シナリオからつくる",
  "wizard-step1": "あたらしい相手",
  "wizard-step2": "あたらしい相手",
  generating: "組み立てています",
  preview: "できあがり",
  error: "あたらしい相手",
};

// ── 生成中（C-1）: 顔を並行で描きつつ本文を段階的に見せる ─────────────────
const GeneratingView = ({ stageIndex }: { stageIndex: number }) => (
  <div className="space-y-4">
    <div className="relative grid aspect-[4/3] w-full place-items-center overflow-hidden rounded-[20px] border border-[var(--hairline)] bg-[linear-gradient(160deg,var(--ink),var(--night))]">
      <div className="flex flex-col items-center">
        <span className="h-9 w-9 animate-spin rounded-full border-2 border-[var(--lamp-22)] border-t-[var(--lamp)]" />
        <p className="mt-3 font-sans-ui text-[12px] text-[var(--dim)]">
          顔を描いています…（本文と並行）
        </p>
      </div>
    </div>
    <div className="space-y-3.5 rounded-[18px] border border-[var(--hairline)] bg-[var(--veil)] p-4">
      {genStages.map((label, i) => {
        const done = i < stageIndex;
        const current = i === stageIndex;
        return (
          <div key={label} className="space-y-1.5">
            <p
              className={cn(
                "font-sans-ui text-[11px] tracking-[0.18em]",
                done || current ? "text-[var(--lamp)]" : "text-[var(--ghost)]",
              )}
            >
              {label}
              {done ? " ✓" : ""}
            </p>
            {current ? (
              <span className="inline-flex items-center gap-2 font-sans-ui text-[12.5px] text-[var(--dim)]">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-[var(--lamp-22)] border-t-[var(--lamp)]" />
                書き起こしています…
              </span>
            ) : (
              <div className="space-y-1.5">
                <span
                  className={cn(
                    "block h-2.5 rounded-full",
                    done ? "bg-[var(--lamp-14)]" : "animate-pulse bg-[var(--hairline)]",
                  )}
                />
                {done && <span className="block h-2.5 w-3/4 rounded-full bg-[var(--lamp-10)]" />}
              </div>
            )}
          </div>
        );
      })}
    </div>
    <p className="text-center font-sans-ui text-[11.5px] text-[var(--ghost)]">
      できた部分から読めます ・ 中断しても入力は残ります
    </p>
  </div>
);

// ── 失敗（C-2）: 世界観のことばで伝え、入力は保持したまま再試行 ───────────
const ErrorView = ({
  onRetry,
  onBackToEntry,
}: {
  onRetry: () => void;
  onBackToEntry: () => void;
}) => (
  <div className="space-y-3 rounded-[18px] border border-[var(--warn-border)] bg-[var(--warn-bg)] p-5">
    <p className="font-narrative text-[17px] font-medium text-[var(--text)]">
      うまく組み立てられませんでした
    </p>
    <p className="font-sans-ui text-[13px] leading-7 text-[var(--warn-text)]">
      選んだ条件と入力はそのまま残っています。少し待ってからもう一度お試しください。
    </p>
    <div className="flex gap-2.5">
      <button type="button" onClick={onRetry} className={cn(ctaPrimaryClass, "h-11 flex-1")}>
        ↻ もう一度
      </button>
      <button
        type="button"
        onClick={onBackToEntry}
        className={cn(wizardOutlineButtonClass, "flex-1 py-2.5")}
      >
        条件を少し変える
      </button>
    </div>
  </div>
);

export const CreateFlow = ({
  open,
  onOpenChange,
  onSaveDirectly,
  onEditAndSave,
  initialUploadedImage,
}: CreateFlowProps) => {
  const model = useSettingsStore((s) => s.model);
  const [step, setStep] = useState<FlowStep>("entry");
  const [selections, setSelections] = useState<CharacterSelections>(initialSelections);
  const [situation, setSituation] = useState("");
  const [details, setDetails] = useState("");
  const [imageMode, setImageMode] = useState<"ai" | "upload">("ai");
  const [uploadedImageDataUrl, setUploadedImageDataUrl] = useState<string | null>(null);
  const [result, setResult] = useState<GeneratedCharacter | null>(null);
  const [lastRequest, setLastRequest] = useState<GenerateRequest | null>(null);
  const [stageIndex, setStageIndex] = useState(0);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [autoInput, setAutoInput] = useState<{ selections: CharacterSelections; details: string }>({
    selections: initialSelections,
    details: "",
  });

  const reset = () => {
    setStep("entry");
    setSelections(initialSelections);
    setSituation("");
    setDetails("");
    setImageMode("ai");
    setUploadedImageDataUrl(null);
    setResult(null);
    setLastRequest(null);
    setStageIndex(0);
    setIsRegenerating(false);
    setAutoInput({ selections: initialSelections, details: "" });
  };

  // 素材管理から画像を持って開かれたら、アップロード側に寄せた状態で始める（#823）。
  // CreateFlow は常時マウントされ open で開閉するので、useState の初期値では
  // 2回目以降の「この素材でつくる」に反映されん。
  useEffect(() => {
    if (!open || !initialUploadedImage) return;
    setImageMode("upload");
    setUploadedImageDataUrl(initialUploadedImage);
  }, [open, initialUploadedImage]);

  useEffect(() => {
    if (step !== "generating") return undefined;
    setStageIndex(0);
    const id = window.setInterval(
      () => setStageIndex((v) => Math.min(v + 1, genStages.length - 1)),
      900,
    );
    return () => window.clearInterval(id);
  }, [step]);

  const runGenerate = async (request: GenerateRequest) => {
    setLastRequest(request);
    setStep("generating");
    try {
      const generated = await generateCharacter({ ...request, model });
      if (imageMode === "upload" && uploadedImageDataUrl) generated.avatar = uploadedImageDataUrl;
      setResult(generated);
      setStep("preview");
    } catch {
      // design原則: 「モデル/API/429」等の技術語はユーザーに見せない
      setStep("error");
    }
  };

  const regenerateFull = async (feedback: string) => {
    if (!result || !lastRequest) return;
    setIsRegenerating(true);
    try {
      setResult(
        await generateCharacter({ ...lastRequest, model, previousResult: result, feedback }),
      );
    } finally {
      setIsRegenerating(false);
    }
  };

  const regenerateFace = async () => {
    if (!result || !lastRequest) return;
    setIsRegenerating(true);
    try {
      const generated = await generateCharacter({
        ...lastRequest,
        model,
        previousResult: result,
        feedback: "顔立ち・見た目の印象だけ作り直して。名前・性格・シナリオは変えないで",
      });
      setResult({ ...result, avatar: generated.avatar });
    } finally {
      setIsRegenerating(false);
    }
  };

  const savePreview = (handler: (r: GeneratedCharacter) => void) => {
    if (!result) return;
    handler(result);
    reset();
    onOpenChange(false);
  };

  // ヘッダーの戻る先（無い画面は閉じる）
  const backTarget: Partial<Record<FlowStep, () => void>> = {
    entry: () => onOpenChange(false),
    auto: () => setStep("entry"),
    scenario: () => setStep("entry"),
    "wizard-step1": () => setStep("entry"),
    "wizard-step2": () => setStep("wizard-step1"),
    preview: () => setStep("entry"),
    error: () => setStep("entry"),
  };
  const onBack = backTarget[step];

  const headerRight: Partial<Record<FlowStep, ReactNode>> = {
    auto: (
      <button
        type="button"
        onClick={() => void runGenerate({ ...autoInput, situation: "おまかせ" })}
        className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md px-3 font-sans-ui text-[13px] tracking-[0.06em] text-[var(--lamp)]"
      >
        もう作って
      </button>
    ),
    generating: (
      <button
        type="button"
        onClick={() => setStep("entry")}
        className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md px-3 font-sans-ui text-[13px] text-[var(--dim)] hover:text-[var(--lamp)]"
      >
        中断
      </button>
    ),
    // A-4: 細かく編集はヘッダー右の小さなリンクで表現し、下部CTAは主導線1本に絞る
    preview: result ? (
      <button
        type="button"
        onClick={() => savePreview(onEditAndSave)}
        className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md px-3 font-sans-ui text-[13px] text-[var(--dim)] hover:text-[var(--lamp)]"
      >
        細かく編集
      </button>
    ) : undefined,
  };

  const renderStep = (): ReactNode => {
    switch (step) {
      case "entry":
        return (
          <OuCreateEntry
            onSelectAuto={() => setStep("auto")}
            onSelectScenario={() => setStep("scenario")}
            onSelectWizard={() => setStep("wizard-step1")}
          />
        );
      case "auto":
        return (
          <OuCreateAuto
            onInputChange={setAutoInput}
            onGenerate={({ selections: s, details: d }) =>
              void runGenerate({ selections: s, details: d, situation: "おまかせ" })
            }
          />
        );
      case "scenario":
        return (
          <OuCreateScenario
            onGenerate={(input) => void runGenerate({ selections: initialSelections, ...input })}
          />
        );
      case "wizard-step1":
        return (
          <WizardStep1
            selections={selections}
            onUpdate={(patch) => setSelections((prev) => ({ ...prev, ...patch }))}
            onNext={() => setStep("wizard-step2")}
          />
        );
      case "wizard-step2":
        return (
          <WizardStep2
            situation={situation}
            details={details}
            imageMode={imageMode}
            uploadedImageDataUrl={uploadedImageDataUrl}
            onImageModeChange={(mode) => {
              setImageMode(mode);
              if (mode === "ai") setUploadedImageDataUrl(null);
            }}
            onUploadedImageChange={setUploadedImageDataUrl}
            onSituationChange={setSituation}
            onDetailsChange={setDetails}
            onBack={() => setStep("wizard-step1")}
            onGenerate={() => void runGenerate({ selections, situation, details })}
            isGenerating={false}
          />
        );
      case "generating":
        return <GeneratingView stageIndex={stageIndex} />;
      case "error":
        return (
          <ErrorView
            onRetry={() => lastRequest && void runGenerate(lastRequest)}
            onBackToEntry={() => setStep("entry")}
          />
        );
      case "preview":
        return result ? (
          <OuCreatePreview
            result={result}
            onRegenerateFull={(fb) => void regenerateFull(fb)}
            onRegenerateFace={() => void regenerateFace()}
            onManualAvatarOverride={(avatar) =>
              setResult((prev) => (prev ? { ...prev, avatar } : prev))
            }
            onSaveDirectly={() => savePreview(onSaveDirectly)}
            onBack={() => setStep("entry")}
            isRegenerating={isRegenerating}
          />
        ) : null;
      default:
        return null;
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        onOpenChange(isOpen);
        if (!isOpen) reset();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="dark create-flow-panel max-h-[90vh] overflow-visible border-[var(--hairline)] p-5 sm:max-w-lg"
      >
        {/* design 1a/1b/1c 共通の「燈」演出。ヘッダー裏で明滅する暖色グロー */}
        <span
          aria-hidden="true"
          className="create-flow-lamp-glow pointer-events-none absolute -top-24 left-1/2 -z-10 h-[220px] w-[300px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,_var(--lamp-22),_transparent_72%)]"
        />
        {/* 画面ごとのヘッダー（戻る・タイトル・右アクション） */}
        <div className="grid grid-cols-[2.5rem_1fr_auto] items-center gap-1">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              aria-label="もどる"
              className="grid h-11 w-11 min-h-[44px] min-w-[44px] place-items-center rounded-full text-[var(--dim)] hover:bg-[var(--lamp-7)] hover:text-[var(--lamp)]"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          ) : (
            <span />
          )}
          <DialogTitle className="text-center font-narrative text-[17px] font-medium tracking-[0.08em] text-[var(--text)]">
            {stepTitle[step]}
          </DialogTitle>
          <div className="min-w-[2.5rem] pr-1 text-right">{headerRight[step] ?? null}</div>
        </div>

        {/* スクロールはこのコンテナだけに適用し、DialogContent 自体は overflow-visible のまま
            グロー演出（-top-24 の絶対配置）をクリップしない */}
        <div className="mt-1 max-h-[calc(90vh-6rem)] overflow-y-auto">{renderStep()}</div>
      </DialogContent>
    </Dialog>
  );
};
