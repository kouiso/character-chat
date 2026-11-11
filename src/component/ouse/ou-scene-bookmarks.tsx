import { useEffect, useState, type CSSProperties } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  deleteSceneBookmark,
  listSceneBookmarks,
  renameSceneBookmark,
  type SceneBookmark,
} from "@/lib/api";
import { queryKey } from "@/lib/query-key";

import { OU2 } from "./ouse-tokens";

// サーバ側の limit 上限。nextCursor はサーバが複合カーソル文字列を返すのにクライアント側の
// スキーマが数値を期待していて parse に失敗するため、ページングにはまだ使えない。
const SCENE_LIST_LIMIT = 200;
const SEARCH_DEBOUNCE_MS = 300;

interface OuSceneBookmarkListProps {
  characterId: string | null;
  onOpen?: (conversationId: string, characterId: string | null, messageId: string) => void;
}

const formatBookmarkDate = (createdAt: number): string => {
  const date = new Date(createdAt);
  return `${date.getMonth() + 1}/${date.getDate()}`;
};

const cardStyle: CSSProperties = {
  borderRadius: 14,
  border: `1px solid ${OU2.hairline}`,
  background: "rgba(20,15,13,.4)",
  padding: "11px 13px",
};

const rowButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 4,
  minWidth: 44,
  minHeight: 44,
  padding: "0 4px",
  background: "none",
  border: "none",
  fontFamily: OU2.round,
  fontSize: 11,
  cursor: "pointer",
};

const BookmarkRow = ({
  bookmark,
  editing,
  draft,
  confirmingDelete,
  renamePending,
  onDraftChange,
  onBeginEdit,
  onCommitEdit,
  onCancelEdit,
  onTapDelete,
  onOpen,
}: {
  bookmark: SceneBookmark;
  editing: boolean;
  draft: string;
  confirmingDelete: boolean;
  renamePending: boolean;
  onDraftChange: (value: string) => void;
  onBeginEdit: () => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
  onTapDelete: () => void;
  onOpen?: () => void;
}) => {
  if (editing) {
    return (
      <div style={cardStyle}>
        <input
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onCommitEdit();
            if (event.key === "Escape") onCancelEdit();
          }}
          autoFocus
          maxLength={200}
          aria-label="場面のなまえ"
          style={{
            width: "100%",
            borderRadius: 10,
            background: "rgba(20,15,13,.7)",
            border: `1px solid ${OU2.lampDim}`,
            padding: "8px 11px",
            fontFamily: OU2.round,
            fontSize: 12.5,
            color: OU2.text,
            outline: "none",
          }}
        />
        <div style={{ display: "flex", gap: 9, marginTop: 8 }}>
          <button
            type="button"
            onClick={onCommitEdit}
            disabled={renamePending || !draft.trim()}
            style={{
              minWidth: 44,
              minHeight: 44,
              padding: "7px 16px",
              borderRadius: 13,
              border: "none",
              background: OU2.lampGrad,
              color: OU2.onLamp,
              fontFamily: OU2.round,
              fontSize: 11.5,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            このなまえにする
          </button>
          <button
            type="button"
            onClick={onCancelEdit}
            style={{
              minWidth: 44,
              minHeight: 44,
              padding: "7px 14px",
              borderRadius: 13,
              border: `1px solid ${OU2.hairline}`,
              background: "none",
              color: OU2.dim,
              fontFamily: OU2.round,
              fontSize: 11.5,
              cursor: "pointer",
            }}
          >
            やめる
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      <button
        type="button"
        onClick={onOpen}
        disabled={!onOpen}
        style={{
          display: "block",
          width: "100%",
          textAlign: "left",
          background: "none",
          border: "none",
          padding: 0,
          cursor: onOpen ? "pointer" : "default",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: 8,
          }}
        >
          <span
            style={{
              fontFamily: OU2.serif,
              fontSize: 12.5,
              color: OU2.text,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {bookmark.title}
          </span>
          <span style={{ fontFamily: OU2.round, fontSize: 10.5, color: OU2.faint, flexShrink: 0 }}>
            {formatBookmarkDate(bookmark.createdAt)}
          </span>
        </div>
        {bookmark.snippet ? (
          <p
            style={{
              margin: "5px 0 0",
              fontFamily: OU2.serif,
              fontSize: 12,
              lineHeight: 1.7,
              color: OU2.faint,
              display: "-webkit-box",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: 2,
              overflow: "hidden",
            }}
          >
            {bookmark.snippet}
          </p>
        ) : null}
        <div style={{ marginTop: 6, fontFamily: OU2.round, fontSize: 10.5, color: OU2.ghost }}>
          {bookmark.characterName}
          {onOpen ? <span style={{ marginLeft: 8, color: OU2.faint }}>この場面へ →</span> : null}
        </div>
      </button>
      <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
        <button
          type="button"
          onClick={onBeginEdit}
          aria-label="なまえを変える"
          style={{ ...rowButtonStyle, color: OU2.faint }}
        >
          <Pencil size={12} />
          なまえ
        </button>
        <button
          type="button"
          // 取り消せない破壊操作なので、記憶の「忘れさせる」と同じ二度タップ確定にする
          onClick={onTapDelete}
          aria-label="この場面を消す"
          style={{ ...rowButtonStyle, color: confirmingDelete ? OU2.lamp : OU2.faint }}
        >
          <Trash2 size={12} />
          {confirmingDelete ? "ほんとうに消す？" : "消す"}
        </button>
      </div>
    </div>
  );
};

const SceneEmptyState = ({ searching }: { searching: boolean }) => (
  <div
    style={{
      paddingTop: 24,
      textAlign: "center",
      color: OU2.faint,
      fontFamily: OU2.round,
      fontSize: 12,
      lineHeight: 1.8,
    }}
  >
    {searching ? "見つかりませんでした" : "保存した場面はまだありません"}
    {searching ? null : (
      <>
        <br />
        <span style={{ fontSize: 11, color: OU2.ghost }}>
          発言の「場面を保存」からここに挟めます
        </span>
      </>
    )}
  </div>
);

export const OuSceneBookmarkList = ({ characterId, onOpen }: OuSceneBookmarkListProps) => {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [onlyThisChar, setOnlyThisChar] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  // 1 文字ごとに一覧を取り直さんよう、打ち止めから少し待って確定した検索語だけを使う
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  const filterCharacterId = onlyThisChar ? characterId : null;
  const { data, isPending, isError } = useQuery({
    queryKey: [...queryKey.sceneBookmarkListRoot, filterCharacterId ?? "all", debouncedQuery],
    queryFn: () =>
      listSceneBookmarks({
        ...(filterCharacterId ? { characterId: filterCharacterId } : {}),
        ...(debouncedQuery ? { q: debouncedQuery } : {}),
        limit: SCENE_LIST_LIMIT,
      }),
  });
  const items = data?.items ?? [];

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: queryKey.sceneBookmarkListRoot });

  const renameMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => renameSceneBookmark(id, title),
    onSuccess: invalidate,
    onError: () => toast.error("なまえを変えられませんでした"),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteSceneBookmark(id),
    onSuccess: invalidate,
    onError: () => toast.error("この場面を消せませんでした"),
  });

  const commitRename = () => {
    const title = draft.trim();
    if (!editingId || !title) return;
    renameMutation.mutate(
      { id: editingId, title },
      {
        onSuccess: () => {
          setEditingId(null);
          setDraft("");
        },
      },
    );
  };

  return (
    <div style={{ marginTop: 16 }}>
      <div
        style={{
          marginBottom: 8,
          fontSize: 11,
          fontFamily: OU2.round,
          color: OU2.faint,
          letterSpacing: "0.12em",
        }}
      >
        保存した場面
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="場面をさがす"
          aria-label="場面をさがす"
          style={{
            flex: 1,
            minWidth: 0,
            borderRadius: 12,
            background: "rgba(20,15,13,.7)",
            border: `1px solid ${OU2.hairline}`,
            padding: "8px 12px",
            fontFamily: OU2.round,
            fontSize: 12,
            color: OU2.text,
            outline: "none",
          }}
        />
        {characterId ? (
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              minHeight: 44,
              fontFamily: OU2.round,
              fontSize: 11,
              color: onlyThisChar ? OU2.lamp : OU2.faint,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            <input
              type="checkbox"
              checked={onlyThisChar}
              onChange={(event) => setOnlyThisChar(event.target.checked)}
              style={{ accentColor: OU2.lamp }}
            />
            このキャラのみ
          </label>
        ) : null}
      </div>

      {isPending ? (
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 24 }}>
          <Loader2 size={16} className="animate-spin" style={{ color: OU2.faint }} />
        </div>
      ) : isError ? (
        <div
          style={{
            paddingTop: 24,
            textAlign: "center",
            color: OU2.faint,
            fontFamily: OU2.round,
            fontSize: 12,
          }}
        >
          場面を読み込めませんでした
        </div>
      ) : items.length === 0 ? (
        <SceneEmptyState searching={debouncedQuery !== ""} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {items.map((bookmark) => (
            <BookmarkRow
              key={bookmark.id}
              bookmark={bookmark}
              editing={editingId === bookmark.id}
              draft={draft}
              confirmingDelete={confirmingDeleteId === bookmark.id}
              renamePending={renameMutation.isPending}
              onDraftChange={setDraft}
              onBeginEdit={() => {
                setConfirmingDeleteId(null);
                setEditingId(bookmark.id);
                setDraft(bookmark.title);
              }}
              onCommitEdit={commitRename}
              onCancelEdit={() => {
                setEditingId(null);
                setDraft("");
              }}
              onTapDelete={() => {
                if (confirmingDeleteId === bookmark.id) {
                  deleteMutation.mutate(bookmark.id);
                  setConfirmingDeleteId(null);
                } else {
                  setEditingId(null);
                  setConfirmingDeleteId(bookmark.id);
                }
              }}
              onOpen={
                onOpen
                  ? () => onOpen(bookmark.conversationId, bookmark.characterId, bookmark.messageId)
                  : undefined
              }
            />
          ))}
        </div>
      )}
    </div>
  );
};
