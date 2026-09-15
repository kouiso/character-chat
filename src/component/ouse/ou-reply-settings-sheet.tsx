import { useMemo, useState } from "react";

import { Sheet, SheetContent, SheetTitle } from "@/component/ui/sheet";
import { cn } from "@/lib/utils";
import {
  resolveCharacterSettings,
  useCharacterSettingsStore,
  type CharacterSettings,
} from "@/store/character-settings-store";
import { useSettingsStore, type ResponseLength } from "@/store/settings-store";

// この子との設定（設計 D-7）: 返事のかたちを「この子（またはこのシーン）だけ」に効かせる。
// キャラ編集（人格）とは別物 — 人格はいじらず、届き方だけ変える。

interface OuReplySettingsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  characterId: string | null;
  characterName: string;
  /** ふたりの記録（OuDrawer: 記憶/シーン/写真/分岐）を開く。#749でメニュー導線を
      本シートへ移した際にDrawerが到達不能になったため、ここから復元する（#757） */
  onOpenRecords?: () => void;
  /** この子と新しい会話を始める。#1459 と同型で、openNewConversation は在ったのに
      呼ぶ側が 1 つも無く、同じ子と最初からやり直す道が画面に存在せんかった。 */
  onStartNewConversation?: () => void;
}

// ResponseLength の4段すべてを出す。3段（long 抜き）やと、チップ（4段を巡回）で
// 「長め」を選んだ後にこのシートを開いた瞬間どのボタンも選択状態にならず、
// そこで何か触ると apply() が3値のどれかを必ず書き込んで「長め」が黙って格下げされる。
// 局長報告の「ながめを選んでも消える」はこの往復。サーバ側も4段それぞれに別の
// 傾き（0.7/1.0/1.3/1.6）と long 専用の longform hint を持っとるので、
// 3段に寄せる側やのうてこちらを4段へ揃える。
const LENGTHS: { key: ResponseLength; label: string }[] = [
  { key: "short", label: "短め" },
  { key: "medium", label: "ふつう" },
  { key: "long", label: "長め" },
  { key: "very_long", label: "たっぷり" },
];

// 指の当たりだけ 44px へ広げる。::before は描画にも layout にも出ないので、
// 詰めた見た目（セグメント 40px・トグル 46x26）はそのまま残る。
const TOUCH_TARGET_44 =
  "relative before:absolute before:left-1/2 before:top-1/2 before:h-full before:min-h-[44px] before:w-full before:min-w-[44px] before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']";

const segClass = (active: boolean): string =>
  cn(
    "flex-1 rounded-[13px] py-2.5 text-center font-sans-ui text-[12px] transition-colors",
    TOUCH_TARGET_44,
    active
      ? "bg-[var(--lamp)] font-bold text-[var(--night)]"
      : "border border-[var(--hairline)] text-[var(--dim)]",
  );

const Toggle = ({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    aria-label={label}
    onClick={onToggle}
    className={cn(
      "h-[26px] w-[46px] shrink-0 rounded-full transition-colors",
      TOUCH_TARGET_44,
      on ? "bg-[var(--lamp)]" : "bg-[var(--hairline)]",
    )}
  >
    {/* left 固定 + translate で移動。left↔right の切替は transition 補間できずジャンプするため */}
    <span
      className={cn(
        "absolute left-[3px] top-[3px] h-5 w-5 rounded-full transition-all",
        on ? "translate-x-[20px] bg-[var(--night)]" : "translate-x-0 bg-[var(--faint)]",
      )}
    />
  </button>
);

export const OuReplySettingsSheet = ({
  open,
  onOpenChange,
  characterId,
  characterName,
  onOpenRecords,
  onStartNewConversation,
}: OuReplySettingsSheetProps) => {
  // 効かせる範囲。現状はキャラ単位で保存（シーン単位は今後）
  const [scope, setScope] = useState<"all" | "scene">("all");
  // セレクタで新規オブジェクトを返すと無限再描画になるため、生スライスを取り useMemo で合成する
  const raw = useCharacterSettingsStore((s) =>
    characterId ? s.byCharacter[characterId] : undefined,
  );
  const patch = useCharacterSettingsStore((s) => s.patch);
  // 未設定の項目は全体設定を継承する。ここで固定の既定値を出すと、実際に効く値と
  // 表示がずれてトグルが嘘をつく。
  const globalResponseLength = useSettingsStore((s) => s.responseLength);
  const globalAutoGenerateImages = useSettingsStore((s) => s.autoGenerateImages);
  const settings = useMemo(
    () =>
      resolveCharacterSettings(raw, {
        responseLength: globalResponseLength,
        autoGenerateImages: globalAutoGenerateImages,
      }),
    [raw, globalResponseLength, globalAutoGenerateImages],
  );
  const apply = (next: Partial<CharacterSettings>) => {
    if (characterId) patch(characterId, next);
  };

  const activeLength = settings.responseLength;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[86dvh] overflow-y-auto rounded-t-[28px] border-[var(--hairline)] bg-[var(--night)]/95 px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-3 text-[var(--text)] shadow-[0_-24px_64px_rgba(5,3,2,.62)] backdrop-blur-[24px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className="mx-auto mb-3 h-1.5 w-11 rounded-full bg-[var(--hairline)]" aria-hidden />
        <SheetTitle className="mb-4 text-center font-narrative text-[17px] font-medium tracking-[0.08em] text-[var(--text)]">
          {characterName}との設定
        </SheetTitle>

        <p className="mb-2.5 font-sans-ui text-[11px] tracking-[0.2em] text-[var(--lamp)]">
          どこに効かせる？
        </p>
        <div className="mb-5 flex gap-2">
          <button
            type="button"
            onClick={() => setScope("all")}
            className={segClass(scope === "all")}
          >
            {characterName}とのぜんぶ
          </button>
          {/* シーン単位の保存はまだ無い。押せると未対応挙動を誘発するため無効化する */}
          <button
            type="button"
            disabled
            aria-disabled
            className={cn(segClass(false), "cursor-not-allowed opacity-40")}
          >
            このシーンだけ（近日対応）
          </button>
        </div>

        <p className="mb-2.5 font-sans-ui text-[11px] tracking-[0.2em] text-[var(--lamp)]">
          返事のかたち
        </p>
        <div className="space-y-4 rounded-[18px] border border-[var(--hairline)] bg-[var(--veil)] p-4">
          <div>
            <p className="mb-2 font-sans-ui text-[12.5px] text-[var(--dim)]">文章の長さ</p>
            <div className="flex gap-1.5">
              {LENGTHS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => apply({ responseLength: key })}
                  className={segClass(activeLength === key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-2 font-sans-ui text-[10.5px] leading-6 text-[var(--ghost)]">
              たっぷり＝状況・描写・セリフ・心の声まで。会話中のチップからも変えられます。
            </p>
          </div>

          <div className="border-t border-[var(--hairline)] pt-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-sans-ui text-[12.5px] text-[var(--dim)]">会話に写真を混ぜる</p>
                <p className="mt-0.5 font-sans-ui text-[10.5px] text-[var(--ghost)]">
                  切ると、ことばだけになる
                </p>
              </div>
              <Toggle
                label="会話に写真を混ぜる"
                on={settings.photoMix}
                onToggle={() => apply({ photoMix: !settings.photoMix })}
              />
            </div>
            {settings.photoMix && (
              <div className="mt-3 flex items-center gap-3">
                <span className="font-sans-ui text-[10.5px] text-[var(--ghost)]">ひかえめ</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(settings.photoFrequency * 100)}
                  onChange={(e) => apply({ photoFrequency: Number(e.target.value) / 100 })}
                  aria-label="写真の頻度"
                  className="h-1.5 flex-1 appearance-none rounded-full bg-[var(--hairline)] accent-[var(--lamp)]"
                />
                <span className="font-sans-ui text-[10.5px] text-[var(--ghost)]">バンバン</span>
              </div>
            )}
          </div>
        </div>

        {onOpenRecords && (
          <button
            type="button"
            onClick={onOpenRecords}
            className="mt-4 flex w-full items-center justify-between rounded-[16px] border border-[var(--hairline)] px-4 py-3.5 text-left transition-colors hover:border-[var(--lamp)]"
          >
            <span>
              <span className="block font-sans-ui text-[12.5px] text-[var(--text)]">
                ふたりの記録
              </span>
              <span className="mt-0.5 block font-sans-ui text-[10.5px] text-[var(--ghost)]">
                記憶・シーン・写真・分岐ツリー
              </span>
            </span>
            <span className="font-sans-ui text-[13px] text-[var(--lamp)]">→</span>
          </button>
        )}

        {onStartNewConversation && (
          <button
            type="button"
            onClick={onStartNewConversation}
            className="mt-3 flex w-full items-center justify-between rounded-[16px] border border-[var(--hairline)] px-4 py-3.5 text-left transition-colors hover:border-[var(--lamp)]"
          >
            <span>
              <span className="block font-sans-ui text-[12.5px] text-[var(--text)]">
                はじめから話す
              </span>
              <span className="mt-0.5 block font-sans-ui text-[10.5px] text-[var(--ghost)]">
                今までの会話は履歴に残ります
              </span>
            </span>
            <span className="font-sans-ui text-[13px] text-[var(--lamp)]">→</span>
          </button>
        )}

        <p className="mt-4 rounded-[16px] border border-dashed border-[var(--hairline)] px-4 py-3 font-sans-ui text-[11.5px] leading-7 text-[var(--dim)]">
          ここでの変更は<b className="text-[var(--lamp)]">この子だけ</b>
          に効きます。ほかの子には影響しません。
        </p>
      </SheetContent>
    </Sheet>
  );
};
