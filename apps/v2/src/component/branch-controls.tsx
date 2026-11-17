import { useEffect, useState } from "react";
import { TalkIcon } from "./talk-icon";

import {
  listBranchSiblings,
  regenerateBranch,
  runBranchAction,
  type BranchSibling,
} from "../lib/branch";

// トークの操作行では別の返事を先に表示し、単独の入口では開くまで系列の取得を待つ。

export type BranchControlsProps = {
  embedded?: boolean;
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
  onSiblings,
}: BranchControlsProps & {
  siblings: BranchSibling[];
  onError: (e: Error) => void;
  onSiblings: (siblings: BranchSibling[]) => void;
}) => {
  const activeIndex = siblings.findIndex((sibling) => sibling.active);
  const refresh = async () => {
    onSiblings(await listBranchSiblings(characterId, conversationId, turn, "assistant"));
  };
  const activate = async (index: number) => {
    const target = siblings[index];
    if (!target || target.active) return;
    try {
      await runBranchAction(characterId, conversationId, {
        action: "activate",
        messageId: target.id,
      });
      await Promise.all([refresh(), onChanged()]);
    } catch (error) {
      onError(error as Error);
    }
  };
  const regenerate = async () => {
    try {
      onSiblings(await regenerateBranch(characterId, conversationId, turn));
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
            <TalkIcon name="back" />
          </button>
          {activeIndex + 1}/{siblings.length}
          <button
            type="button"
            aria-label="次の枝"
            disabled={busy || activeIndex < 0 || activeIndex >= siblings.length - 1}
            onClick={() => void activate(activeIndex + 1)}
          >
            <TalkIcon name="next" />
          </button>
        </span>
      )}
      <button type="button" onClick={() => void regenerate()} disabled={busy}>
        再生成
      </button>
    </>
  );
};

const BranchClose = ({ embedded, onClose }: { embedded?: boolean; onClose: () => void }) =>
  embedded ? null : (
    <button type="button" className="v2-branch-close" aria-label="閉じる" onClick={onClose}>
      <TalkIcon name="close" />
    </button>
  );

export const BranchControls = (props: BranchControlsProps) => {
  const { characterId, conversationId, role, turn, busy, onChanged, onRewound } = props;
  const [open, setOpen] = useState(props.embedded === true);
  const [siblings, setSiblings] = useState<BranchSibling[]>([]);
  useEffect(() => {
    if (!props.embedded) return;
    let active = true;
    void listBranchSiblings(characterId, conversationId, turn, role)
      .then((items) => {
        if (active) setSiblings(items);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [props.embedded, characterId, conversationId, turn, role]);
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
        <TalkIcon name="more" />
      </button>
    );
  }

  return (
    <div className="v2-branch-controls" data-embedded={props.embedded}>
      {role === "assistant" && (
        <AssistantControls
          {...props}
          siblings={siblings}
          onError={(e) => setError(e.message)}
          onSiblings={setSiblings}
        />
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
      <BranchClose embedded={props.embedded} onClose={() => setOpen(false)} />
      {error && <div className="v2-branch-error">{error}</div>}
    </div>
  );
};
