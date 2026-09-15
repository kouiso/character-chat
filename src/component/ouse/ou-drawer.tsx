import { useRef, useState, type KeyboardEvent } from "react";

import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/component/ui/sheet";
import { listMemoryNotes } from "@/lib/api";
import { queryKey } from "@/lib/query-key";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/store/chat-store";

import { OuBranchTree } from "./ou-branch-tree";
import { OuPhotoScreen } from "./ou-photo-screen";
import { OU2 } from "./ouse-tokens";

type DrawerTab = "memory" | "scene" | "photo" | "branch";

const TABS: { id: DrawerTab; label: string }[] = [
  { id: "memory", label: "記憶" },
  { id: "scene", label: "場面" },
  { id: "photo", label: "写真" },
  { id: "branch", label: "分岐" },
];

// 選択中がゴールドの縁と文字色だけで示されており、色を見分けられん人には
// どれが開いているか届いていなかった。中身を差し替える tab なので
// aria-pressed（押しっぱなしボタン）ではなく tablist として名乗る。
const TAB_PANEL_ID = "ou-drawer-panel";
const tabButtonId = (id: DrawerTab): string => `ou-drawer-tab-${id}`;

interface OuDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  messages: ChatMessage[];
  characterId: string | null;
  characterName: string;
  conversationId?: string | null;
  onOpenConversation?: (conversationId: string, characterId?: string) => void;
}

// ずっと「まだ記憶はありません」を静的に固定表示しており、実データの有無に関わらず
// 記憶が無いと断言していた。ou-memory-screen.tsx と同じ listMemoryNotes を呼ぶ。
const MemoryTab = ({
  characterId,
  characterName,
}: {
  characterId: string | null;
  characterName: string;
}) => {
  const {
    data: notes = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: queryKey.memoryNotes(characterId),
    queryFn: () => listMemoryNotes(characterId),
    enabled: !!characterId,
  });

  return (
    <div
      style={{
        flex: 1,
        padding: "8px 0",
        color: OU2.dim,
        fontFamily: OU2.round,
        fontSize: 13,
        letterSpacing: "0.06em",
      }}
    >
      <div
        style={{
          marginBottom: 12,
          fontSize: 11,
          color: OU2.faint,
          letterSpacing: "0.12em",
        }}
      >
        {characterName} が覚えていること
      </div>
      {isLoading ? (
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 32 }}>
          <Loader2 size={16} className="animate-spin" style={{ color: OU2.faint }} />
        </div>
      ) : isError ? (
        // 取得に失敗しても notes は [] のままなので、区別せんと「記憶が無い」と
        // 断言してまう。実際には在るかもしれん。
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            paddingTop: 32,
            color: OU2.faint,
            fontSize: 12,
          }}
        >
          記憶を読み込めませんでした
        </div>
      ) : notes.length === 0 ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            paddingTop: 32,
            color: OU2.faint,
            fontSize: 12,
          }}
        >
          まだ記憶はありません
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {notes.map((note) => (
            <div
              key={note.id}
              style={{
                padding: "10px 12px",
                borderRadius: 12,
                border: `1px solid ${OU2.hairline}`,
                fontSize: 12.5,
                lineHeight: 1.7,
                color: OU2.text,
              }}
            >
              {note.content}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const SceneTab = ({ messages }: { messages: ChatMessage[] }) => {
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  return (
    <div
      style={{
        flex: 1,
        padding: "8px 0",
        color: OU2.dim,
        fontFamily: OU2.serif,
        fontSize: 13,
        lineHeight: 1.8,
        letterSpacing: "0.06em",
      }}
    >
      {lastAssistant ? (
        <>
          <div
            style={{
              marginBottom: 8,
              fontSize: 11,
              fontFamily: OU2.round,
              color: OU2.faint,
              letterSpacing: "0.12em",
            }}
          >
            現在の場面
          </div>
          <p style={{ margin: 0, color: OU2.faint }}>
            {lastAssistant.content.slice(0, 200)}
            {lastAssistant.content.length > 200 ? "…" : ""}
          </p>
        </>
      ) : (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            paddingTop: 32,
            color: OU2.faint,
            fontSize: 12,
            fontFamily: OU2.round,
          }}
        >
          場面はまだ始まっていません
        </div>
      )}
    </div>
  );
};

export const OuDrawer = ({
  open,
  onOpenChange,
  messages,
  characterId,
  characterName,
  conversationId,
  onOpenConversation,
}: OuDrawerProps) => {
  const [activeTab, setActiveTab] = useState<DrawerTab>("memory");
  const tabRefs = useRef<Partial<Record<DrawerTab, HTMLButtonElement | null>>>({});

  // tablist を名乗る以上、左右キーでの移動まで揃えんと読み上げの案内と操作がずれる。
  const moveTab = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const current = TABS.findIndex(({ id }) => id === activeTab);
    const next = TABS[(current + step + TABS.length) % TABS.length].id;
    setActiveTab(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className={cn(
          "max-h-[82dvh] rounded-t-[28px] border-[var(--hairline)] bg-[var(--night)]/95 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 text-[var(--text)] shadow-[0_-24px_64px_rgba(5,3,2,.62)] backdrop-blur-[24px]",
          "data-[side=bottom]:data-ending-style:translate-y-full data-[side=bottom]:data-starting-style:translate-y-full",
        )}
      >
        <div
          className="mx-auto h-1.5 w-12 rounded-full bg-[var(--ghost)] shadow-[var(--read-shadow-soft)]"
          aria-hidden="true"
        />
        <SheetHeader className="px-0 pb-1 pt-4 text-left">
          <SheetTitle className="font-narrative text-[20px] font-medium tracking-[0.18em] text-[var(--text)] [text-shadow:var(--read-shadow)]">
            ふたりの抽斗
          </SheetTitle>
          <SheetDescription className="font-round text-[12px] leading-6 tracking-[0.06em] text-[var(--dim)] [text-shadow:var(--read-shadow-soft)]">
            ふたりの間に積み重なったもの。
          </SheetDescription>
        </SheetHeader>

        {/* タブバー */}
        <div
          role="tablist"
          aria-label="ふたりの抽斗"
          style={{
            display: "flex",
            gap: 4,
            paddingBottom: 12,
            borderBottom: `1px solid ${OU2.hairline}`,
            marginBottom: 12,
            overflowX: "auto",
          }}
        >
          {TABS.map(({ id, label }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                ref={(node) => {
                  tabRefs.current[id] = node;
                }}
                type="button"
                role="tab"
                id={tabButtonId(id)}
                aria-selected={active}
                aria-controls={TAB_PANEL_ID}
                tabIndex={active ? 0 : -1}
                onClick={() => setActiveTab(id)}
                onKeyDown={moveTab}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minWidth: 44,
                  minHeight: 44,
                  fontFamily: OU2.round,
                  fontSize: 11,
                  letterSpacing: "0.18em",
                  padding: "4px 14px",
                  borderRadius: 99,
                  border: active ? `1px solid ${OU2.lampDim}` : "1px solid transparent",
                  background: active ? "rgba(204,161,72,.12)" : "none",
                  color: active ? OU2.lamp : OU2.faint,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  transition: "color 0.15s, background 0.15s",
                  flexShrink: 0,
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* タブコンテンツ */}
        <div
          id={TAB_PANEL_ID}
          role="tabpanel"
          aria-labelledby={tabButtonId(activeTab)}
          tabIndex={0}
          style={{ display: "flex", flexDirection: "column", minHeight: 160, overflowY: "auto" }}
        >
          {activeTab === "memory" && (
            <MemoryTab characterId={characterId} characterName={characterName} />
          )}
          {activeTab === "scene" && <SceneTab messages={messages} />}
          {activeTab === "photo" && (
            <OuPhotoScreen messages={messages} characterName={characterName} />
          )}
          {activeTab === "branch" && (
            <OuBranchTree
              conversationId={conversationId}
              onOpen={(convId, charId) => {
                onOpenConversation?.(convId, charId);
                onOpenChange(false);
              }}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};
