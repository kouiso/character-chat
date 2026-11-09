import { useState } from "react";

import { listBranchSiblings, runBranchAction, type BranchSibling } from "../lib/branch";

// RIT-202: バブル横の枝操作。「⋯」を開いた時だけ系列を読みに行くので、
// 枝が無い会話では余計な往復が出ない。操作後は onChanged で履歴を読み直す。

export type BranchControlsProps = {
  characterId: string;
  conversationId: string;
  role: "user" | "assistant";
  turn: number;
  busy: boolean;
  onChanged: () => Promise<void>;
  onRewound: (fromTurn: number) => void;
};

const AssistantControls = ({
  characterId,
  conversationId,
  turn,
  busy,
  siblings,
  onChanged,
  onError,
}: BranchControlsProps & { siblings: BranchSibling[]; onError: (e: Error) => void }) => {
  const activeIndex = siblings.findIndex((sibling) => sibling.active);
  const activate = async (index: number) => {
    const target = siblings[index];
    if (!target || target.active) return;
    try {
      await runBranchAction(characterId, conversationId, {
        action: "activate",
        messageId: target.id,
      });
      await onChanged();
    } catch (error) {
      onError(error as Error);
    }
  };
  const regenerate = async () => {
    try {
      await runBranchAction(characterId, conversationId, { action: "regenerate", turn });
      await onChanged();
    } catch (error) {
      onError(error as Error);
    }
  };
  return (
    <>
      {siblings.length > 1 && (
        <span className="v2-branch-nav">
          <button
            type="button"
            aria-label="前の枝"
            disabled={busy || activeIndex <= 0}
            onClick={() => void activate(activeIndex - 1)}
          >
            ◀
          </button>
          {activeIndex + 1}/{siblings.length}
          <button
            type="button"
            aria-label="次の枝"
            disabled={busy || activeIndex < 0 || activeIndex >= siblings.length - 1}
            onClick={() => void activate(activeIndex + 1)}
          >
            ▶
          </button>
        </span>
      )}
      <button type="button" onClick={() => void regenerate()} disabled={busy}>
        再生成
      </button>
    </>
  );
};

export const BranchControls = (props: BranchControlsProps) => {
  const { characterId, conversationId, role, turn, busy, onChanged, onRewound } = props;
  const [open, setOpen] = useState(false);
  const [siblings, setSiblings] = useState<BranchSibling[]>([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    if (open) {
      setOpen(false);
      setEditing(false);
      return;
    }
    setOpen(true);
    try {
      setSiblings(await listBranchSiblings(characterId, conversationId, turn, role));
    } catch {
      setSiblings([]);
    }
  };

  const rewrite = async () => {
    const content = draft.trim();
    if (!content) return;
    try {
      await runBranchAction(characterId, conversationId, { action: "rewrite", turn, content });
      setEditing(false);
      setOpen(false);
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const rewind = async () => {
    try {
      await runBranchAction(characterId, conversationId, { action: "truncate", fromTurn: turn });
      setOpen(false);
      onRewound(turn);
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        className="v2-branch-toggle"
        aria-label="枝操作"
        aria-expanded={false}
        disabled={busy}
        onClick={() => void toggle()}
      >
        ⋯
      </button>
    );
  }

  return (
    <div className="v2-branch-controls">
      {role === "assistant" && (
        <AssistantControls {...props} siblings={siblings} onError={(e) => setError(e.message)} />
      )}
      {role === "user" && (
        <>
          {editing ? (
            <>
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                aria-label="メッセージの書き直し"
                rows={3}
              />
              <button type="button" onClick={() => void rewrite()} disabled={busy || !draft.trim()}>
                書き直す
              </button>
              <button type="button" onClick={() => setEditing(false)}>
                やめる
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                setEditing(true);
                setDraft(siblings.find((sibling) => sibling.active)?.content ?? "");
              }}
              disabled={busy}
            >
              書き直す
            </button>
          )}
          <button type="button" onClick={() => void rewind()} disabled={busy}>
            ここから戻る
          </button>
        </>
      )}
      <button type="button" aria-label="閉じる" onClick={() => setOpen(false)}>
        ×
      </button>
      {error && <div className="v2-branch-error">{error}</div>}
    </div>
  );
};
