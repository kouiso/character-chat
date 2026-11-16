// 記憶の画面（RIT-92・板 Memory / Memory-2 / Memory-3）。
// 会話ごとの記憶を節（長く・さいきん・ふたり・これから）に分けて見せ、
// 行を押すと書き換えるシート、「記憶を足す」で足すシートを出す。
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";

import { listMemories, restoreMemory, updateMemory, type Memory } from "../lib/memories";
import { jstDateKey } from "../server/jst-date";

import { MemoryAddSheet } from "./memory-add-sheet";
import { MemoryDeleteSheet } from "./memory-delete-sheet";
import { MemoryEditSheet } from "./memory-edit-sheet";

import "./memory-screen.css";

export const CATEGORIES = [
  { key: "long", label: "長く覚える事", pill: "長く" },
  { key: "recent", label: "さいきんの事", pill: "さいきん" },
  { key: "relation", label: "ふたりの関係", pill: "ふたり" },
  { key: "future", label: "これからの事", pill: "これから" },
] as const;
export type CategoryKey = (typeof CATEGORIES)[number]["key"];

export const categoryLabel = (key: string): string =>
  CATEGORIES.find((category) => category.key === key)?.label ?? CATEGORIES[0].label;

// 日付の見せ方（板 A-4・B-2）。JST で今日は「きょう」、前日は「きのう」、ほかは「M月D日」。
export const memoryDateLabel = (createdAt: number, now = Date.now()): string => {
  const key = jstDateKey(createdAt);
  if (key === jstDateKey(now)) return "きょう";
  if (key === jstDateKey(now - 86_400_000)) return "きのう";
  const [, month, day] = key.split("-").map(Number);
  return `${month}月${day}日`;
};

const NEW_MEMORY_WINDOW_MS = 48 * 60 * 60 * 1000;
const TOAST_MS = 10_000;

export const PinIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
    <path
      d="M9.5 2.5l4 4-2.2.7-2.6 2.6-.4 3.7-1.6-1.6-2.9 2.9-.7-.7 2.9-2.9-1.6-1.6 3.7-.4 2.6-2.6z"
      fill="currentColor"
    />
  </svg>
);

const EditIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
    <path
      d="M10.6 2.6l2.8 2.8-7 7L3 13l.6-3.4zm1.4-1.4l1.4 1.4-1.4 1.4-1.4-1.4z"
      fill="currentColor"
    />
  </svg>
);

const UsedIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
    <path
      d="M2 8c2-3.3 4.5-5 6-5s4 1.7 6 5c-2 3.3-4.5 5-6 5s-4-1.7-6-5z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <circle cx="8" cy="8" r="2" fill="currentColor" />
  </svg>
);

const BackIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
    <path
      d="M12.5 4.5L6.8 10l5.7 5.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const MoreIcon = () => (
  <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
    <circle cx="5.5" cy="11" r="1.9" fill="none" stroke="currentColor" strokeWidth="2.2" />
    <circle cx="11" cy="11" r="1.9" fill="none" stroke="currentColor" strokeWidth="2.2" />
    <circle cx="16.5" cy="11" r="1.9" fill="none" stroke="currentColor" strokeWidth="2.2" />
  </svg>
);

const EmptyIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden>
    <path
      d="M12 3a6 6 0 0 0-6 6c0 2.4 1.4 3.9 2.5 5.2.9 1 1.5 1.7 1.5 2.8h4c0-1.1.6-1.8 1.5-2.8C16.6 12.9 18 11.4 18 9a6 6 0 0 0-6-6zM10 19h4v1.5h-4z"
      fill="currentColor"
    />
  </svg>
);

// 行の印（板 A-4）。左から: 固定/新着 → 自分で直した → 自分で足した/日付 → 使った/置き換わった。
const MemoryBadges = ({ memory }: { memory: Memory }) => (
  <span className="v2-memory-row-meta">
    {memory.pinned ? (
      <span className="v2-memory-badge">
        <PinIcon />
        固定
      </span>
    ) : (
      memory.origin === "extracted" &&
      Date.now() - memory.createdAt <= NEW_MEMORY_WINDOW_MS && (
        <span className="v2-memory-badge">
          <span className="v2-memory-badge-dot" />
          新着
        </span>
      )
    )}
    {memory.editedAt !== null && (
      <span className="v2-memory-badge">
        <EditIcon />
        自分で直した
      </span>
    )}
    {memory.origin === "manual" && memory.editedAt === null ? (
      <span className="v2-memory-badge">
        <EditIcon />
        自分で足した
      </span>
    ) : (
      <span>{memoryDateLabel(memory.createdAt)}</span>
    )}
    {memory.usedInLastReply ? (
      <span className="v2-memory-badge">
        <UsedIcon />
        さっきの返事で使った
      </span>
    ) : (
      memory.supersededBy !== null && <span>新しい記憶に置き換わった</span>
    )}
  </span>
);

type SheetState =
  | { type: "add" }
  | { type: "edit"; memory: Memory }
  | { type: "delete"; memory: Memory }
  // 「…」のシートの中身（会話/キャラの全削除）は RIT-196 の担当。ここは枠だけ。
  | { type: "more" }
  | null;

type Toast = {
  key: number;
  text: string;
  action?: { label: string; run: () => Promise<void> };
};

type MemoryScreenProps = {
  characterId: string;
  characterName: string;
  conversationId: string | null;
};

// ひとつの節（見出し・行・ほか N 件）。
const MemorySection = ({
  label,
  items,
  expanded,
  onExpand,
  onEdit,
}: {
  label: string;
  items: Memory[];
  expanded: boolean;
  onExpand: () => void;
  onEdit: (memory: Memory) => void;
}) => {
  const shown = expanded ? items : items.slice(0, 3);
  return (
    <section className="v2-memory-section">
      <h2 className="v2-memory-section-title">{label}</h2>
      <div className="v2-memory-card">
        {shown.map((memory) => (
          <button
            key={memory.id}
            type="button"
            className="v2-memory-row"
            aria-label={`書き換える ${memory.content}`}
            onClick={() => onEdit(memory)}
          >
            <span className="v2-memory-row-body">
              <span className="v2-memory-row-text">{memory.content}</span>
              <MemoryBadges memory={memory} />
            </span>
          </button>
        ))}
      </div>
      {items.length > shown.length && (
        <button type="button" className="v2-memory-more" onClick={onExpand}>
          ほか {items.length - shown.length} 件を見る
        </button>
      )}
    </section>
  );
};

const MemoryEmpty = ({ characterName, onAdd }: { characterName: string; onAdd: () => void }) => (
  <div className="v2-memory-empty">
    <span className="v2-memory-empty-icon">
      <EmptyIcon />
    </span>
    <p className="v2-memory-empty-title">まだ、記憶はありません</p>
    <p className="v2-memory-empty-copy">
      会話を重ねると、{characterName}が覚えた事が
      <br />
      ここに並びます。自分で足すこともできます。
    </p>
    <button type="button" className="v2-memory-primary" onClick={onAdd}>
      記憶を足す
    </button>
  </div>
);

// 「…」から出す枠（RIT-196 の本実装まで行は無効のまま据え置く）。
const MoreSheet = ({ characterName, onClose }: { characterName: string; onClose: () => void }) => (
  <div className="v2-memory-sheet-overlay" onClick={onClose}>
    <div
      className="v2-memory-sheet"
      role="dialog"
      aria-label="記憶の削除"
      onClick={(event) => event.stopPropagation()}
    >
      <span className="v2-memory-sheet-grabber" />
      <div className="v2-memory-sheet-header">
        <h2 className="v2-memory-sheet-title">記憶の削除</h2>
      </div>
      <div className="v2-memory-card">
        <button type="button" className="v2-memory-row" aria-label="この会話の記憶を削除" disabled>
          <span className="v2-memory-row-body">
            <span className="v2-memory-row-text">この会話の記憶を削除</span>
          </span>
        </button>
        <button
          type="button"
          className="v2-memory-row"
          aria-label={`${characterName}の記憶をすべて削除`}
          disabled
        >
          <span className="v2-memory-row-body">
            <span className="v2-memory-row-text">{characterName}の記憶をすべて削除</span>
          </span>
        </button>
      </div>
      <p className="v2-memory-note">この画面からは消えず、会話の本文にも残ります。</p>
    </div>
  </div>
);

// 本体（骨組み・失敗・空・節の一覧・足すボタン）。
const MemoryBody = ({
  status,
  sections,
  expanded,
  characterName,
  onRetry,
  onAdd,
  onExpand,
  onEdit,
}: {
  status: "loading" | "error" | "ready";
  sections: { key: CategoryKey; label: string; items: Memory[] }[];
  expanded: Set<CategoryKey>;
  characterName: string;
  onRetry: () => void;
  onAdd: () => void;
  onExpand: (key: CategoryKey) => void;
  onEdit: (memory: Memory) => void;
}) => {
  if (status === "loading") {
    return (
      <div className="v2-memory-body" aria-busy="true">
        <span className="v2-sr-only">読み込んでいます</span>
        <div className="v2-memory-skeleton" aria-hidden>
          {[0, 1, 2, 3].map((line) => (
            <span key={line} className={`v2-memory-skeleton-line ${line % 2 === 1 ? "alt" : ""}`} />
          ))}
        </div>
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="v2-memory-body">
        <div className="v2-memory-error-card">
          <span>記憶を読み込めませんでした。</span>
          <button type="button" className="v2-memory-secondary" onClick={onRetry}>
            もう一度
          </button>
        </div>
      </div>
    );
  }
  if (sections.length === 0) {
    return <MemoryEmpty characterName={characterName} onAdd={onAdd} />;
  }
  return (
    <div className="v2-memory-body">
      <p className="v2-memory-lead">
        {characterName}が会話から覚えた事です。違っていたら、押して書き換えられます。
      </p>
      {sections.map((section) => (
        <MemorySection
          key={section.key}
          label={section.label}
          items={section.items}
          expanded={expanded.has(section.key)}
          onExpand={() => onExpand(section.key)}
          onEdit={onEdit}
        />
      ))}
      <button type="button" className="v2-memory-primary" onClick={onAdd}>
        記憶を足す
      </button>
    </div>
  );
};

export const MemoryScreen = ({
  characterId,
  characterName,
  conversationId: requestedConversationId,
}: MemoryScreenProps) => {
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
  const [memories, setMemories] = useState<Memory[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<CategoryKey>>(new Set());
  const [sheet, setSheet] = useState<SheetState>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<number | null>(null);

  const showToast = useCallback((next: Omit<Toast, "key">) => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    setToast({ key: Date.now(), ...next });
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS);
  }, []);
  useEffect(
    () => () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const result = await listMemories(characterId, requestedConversationId);
      setMemories(result.memories);
      setConversationId(result.conversationId);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [characterId, requestedConversationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const patchLocal = (updated: Memory) =>
    setMemories((previous) => previous.map((entry) => (entry.id === updated.id ? updated : entry)));

  const undoEdit = (before: Memory, after: Memory) => async () => {
    const restored = await updateMemory(characterId, {
      memoryId: after.id,
      expectedRevision: after.revision,
      content: before.content,
      category: before.category,
      pinned: before.pinned,
    });
    patchLocal(restored);
  };

  const runToastAction = async (action: { label: string; run: () => Promise<void> }) => {
    try {
      await action.run();
      setToast(null);
    } catch {
      showToast({
        text: "記憶を保存できませんでした。",
        action: { label: "もう一度", run: action.run },
      });
    }
  };

  const onEdited = (before: Memory, after: Memory) => {
    patchLocal(after);
    setSheet(null);
    showToast({
      text: "記憶を書き換えました",
      action: { label: "元に戻す", run: undoEdit(before, after) },
    });
  };

  const onDeleted = (memory: Memory) => {
    setMemories((previous) => previous.filter((entry) => entry.id !== memory.id));
    setSheet(null);
    showToast({
      text: "記憶を削除しました",
      action: {
        label: "元に戻す",
        run: async () => {
          await restoreMemory(characterId, memory.id);
          await load();
        },
      },
    });
  };

  const onAdded = () => {
    setSheet(null);
    showToast({ text: "記憶を足しました" });
    void load();
  };

  const sections = CATEGORIES.map((category) => ({
    ...category,
    items: memories.filter((entry) => entry.category === category.key),
  })).filter((section) => section.items.length > 0);

  return (
    <div className="v2-memory-page">
      <header className="v2-memory-header">
        <Link
          to="/chat/$id"
          params={{ id: characterId }}
          search={conversationId ? { conversationId } : {}}
          className="v2-memory-icon-button"
          aria-label="戻る"
        >
          <BackIcon />
        </Link>
        <h1 className="v2-memory-title">記憶</h1>
        {status === "ready" && memories.length > 0 && (
          <button
            type="button"
            className="v2-memory-icon-button subtle"
            aria-label="もっと（記憶の削除）"
            onClick={() => setSheet({ type: "more" })}
          >
            <MoreIcon />
          </button>
        )}
      </header>

      <MemoryBody
        status={status}
        sections={sections}
        expanded={expanded}
        characterName={characterName}
        onRetry={() => void load()}
        onAdd={() => setSheet({ type: "add" })}
        onExpand={(key) => setExpanded((previous) => new Set(previous).add(key))}
        onEdit={(memory) => setSheet({ type: "edit", memory })}
      />

      <MemorySheets
        sheet={sheet}
        characterId={characterId}
        characterName={characterName}
        conversationId={conversationId}
        onClose={() => setSheet(null)}
        onAdded={onAdded}
        onEdited={onEdited}
        onDeleted={onDeleted}
        onMissing={() => void load()}
        onDeleteRequest={(memory) => setSheet({ type: "delete", memory })}
        onDeleteCancel={(memory) => setSheet({ type: "edit", memory })}
      />

      {toast && (
        <div key={toast.key} className="v2-memory-toast" role="status">
          <span className="v2-memory-toast-text">{toast.text}</span>
          {toast.action && (
            <button
              type="button"
              className="v2-memory-toast-action"
              onClick={() => {
                const action = toast.action;
                if (action) void runToastAction(action);
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// 出し分けるシートの束（足す・書き換え・削除の確かめ・「…」の枠）。
const MemorySheets = ({
  sheet,
  characterId,
  characterName,
  conversationId,
  onClose,
  onAdded,
  onEdited,
  onDeleted,
  onMissing,
  onDeleteRequest,
  onDeleteCancel,
}: {
  sheet: SheetState;
  characterId: string;
  characterName: string;
  conversationId: string | null;
  onClose: () => void;
  onAdded: () => void;
  onEdited: (before: Memory, after: Memory) => void;
  onDeleted: (memory: Memory) => void;
  onMissing: () => void;
  onDeleteRequest: (memory: Memory) => void;
  onDeleteCancel: (memory: Memory) => void;
}) => {
  if (sheet?.type === "add") {
    return (
      <MemoryAddSheet
        characterId={characterId}
        conversationId={conversationId}
        onClose={onClose}
        onAdded={onAdded}
      />
    );
  }
  if (sheet?.type === "edit") {
    return (
      <MemoryEditSheet
        key={sheet.memory.id}
        characterId={characterId}
        characterName={characterName}
        memory={sheet.memory}
        onClose={onClose}
        onSaved={onEdited}
        onDeleteRequest={() => onDeleteRequest(sheet.memory)}
        onMissing={onMissing}
      />
    );
  }
  if (sheet?.type === "delete") {
    return (
      <MemoryDeleteSheet
        characterId={characterId}
        memory={sheet.memory}
        onCancel={() => onDeleteCancel(sheet.memory)}
        onDeleted={onDeleted}
      />
    );
  }
  if (sheet?.type === "more") {
    return <MoreSheet characterName={characterName} onClose={onClose} />;
  }
  return null;
};

// 閉じる確かめのシート（板 B・C 共通）。dirty な時だけ出す。
export const ConfirmCloseSheet = ({
  onDiscard,
  onBack,
}: {
  onDiscard: () => void;
  onBack: () => void;
}) => (
  <div className="v2-memory-sheet-overlay">
    <div className="v2-memory-sheet" role="alertdialog" aria-label="保存せずに閉じますか？">
      <span className="v2-memory-sheet-grabber" />
      <h2 className="v2-memory-sheet-title">保存せずに閉じますか？</h2>
      <p className="v2-memory-note">保存していない変更が消えます。</p>
      <div className="v2-memory-sheet-actions">
        <button type="button" className="v2-memory-secondary" onClick={onDiscard}>
          保存せずに閉じる
        </button>
        <button type="button" className="v2-memory-primary" onClick={onBack}>
          編集に戻る
        </button>
      </div>
    </div>
  </div>
);
