import { AuthenticatedImage } from "@/component/ui/authenticated-image";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/component/ui/sheet";
import type { Character } from "@/lib/api";

import { OU2 } from "./ouse-tokens";

interface OuFacesSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  characters: Character[];
  activeCharacterId: string | null;
  onSelectCharacter: (id: string) => void;
  onAddCharacter?: () => void;
}

export const OuFacesSheet = ({
  open,
  onOpenChange,
  characters,
  activeCharacterId,
  onSelectCharacter,
  onAddCharacter,
}: OuFacesSheetProps) => (
  <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent
      side="bottom"
      className="max-h-[72dvh] rounded-t-[28px] border-[var(--hairline)] bg-[var(--night)]/95 px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-3 text-[var(--text)] shadow-[0_-24px_64px_rgba(5,3,2,.62)] backdrop-blur-[24px]"
    >
      <div
        style={{
          margin: "0 auto 16px",
          width: 44,
          height: 5,
          borderRadius: 3,
          // 設計はランプ暖色のグリップ。冷色の白はシートの世界観から浮くため lamp 系トーンに寄せる
          background: OU2.lampDim,
        }}
        aria-hidden
      />
      <SheetHeader className="px-0 pb-2 pt-0 text-left">
        <SheetTitle
          style={{
            fontFamily: OU2.round,
            fontSize: 13,
            letterSpacing: "0.18em",
            color: OU2.faint,
          }}
        >
          相手をえらぶ
        </SheetTitle>
        <SheetDescription className="sr-only">会う相手を選んでください</SheetDescription>
      </SheetHeader>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, overflowY: "auto" }}>
        {characters.map((char) => {
          const active = char.id === activeCharacterId;
          // アクティブは進行中の情報、他は最後のひと言（greeting）を添えて「戻りたくなる」導線にする
          const subtitle = active
            ? "進行中"
            : char.greeting?.trim()
              ? `「${char.greeting.trim()}」`
              : null;
          // 認証フェッチ失敗時のフォールバックと avatar 未設定時の表示は同じ頭文字プレースホルダーなので共有する
          const avatarFallback = (
            <span style={{ fontFamily: OU2.serif, fontSize: 18, color: OU2.dim }}>
              {char.name[0]}
            </span>
          );
          return (
            <button
              key={char.id}
              type="button"
              onClick={() => {
                onSelectCharacter(char.id);
                onOpenChange(false);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 13,
                padding: "11px 13px",
                borderRadius: 16,
                // 設計のアクティブ枠は暖色ランプの淡いゴールド。トークンに一致色が無いため設計値を採用
                border: active ? "1px solid rgba(231,201,135,.45)" : "1px solid transparent",
                background: active ? "rgba(204,161,72,.1)" : "rgba(251,247,239,.04)",
                cursor: "pointer",
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 99,
                  overflow: "hidden",
                  flexShrink: 0,
                  background: OU2.ink,
                  border: `1px solid ${OU2.hairline}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {char.avatar ? (
                  <AuthenticatedImage
                    src={char.avatar}
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    fallback={avatarFallback}
                  />
                ) : (
                  avatarFallback
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                <div
                  style={{
                    fontFamily: OU2.serif,
                    fontSize: 16,
                    color: active ? OU2.lamp : OU2.text,
                    letterSpacing: "0.06em",
                  }}
                >
                  {char.name}
                </div>
                {subtitle && (
                  <div
                    style={{
                      fontFamily: OU2.round,
                      fontSize: 11,
                      color: OU2.faint,
                      marginTop: 2,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {subtitle}
                  </div>
                )}
              </div>
              {active && (
                <span style={{ fontSize: 10, letterSpacing: "0.2em", color: OU2.lamp }}>
                  いまここ
                </span>
              )}
            </button>
          );
        })}

        {onAddCharacter && (
          <button
            type="button"
            onClick={() => {
              onAddCharacter();
              onOpenChange(false);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 13,
              padding: "11px 13px",
              borderRadius: 16,
              border: `1px dashed ${OU2.hairline}`,
              background: "transparent",
              cursor: "pointer",
              color: OU2.faint,
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 99,
                border: `1px dashed ${OU2.hairline}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                  d="M8 3.5v9M3.5 8h9"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <span style={{ fontFamily: OU2.round, fontSize: 13, letterSpacing: "0.1em" }}>
              キャラを追加する
            </span>
          </button>
        )}
      </div>
    </SheetContent>
  </Sheet>
);
