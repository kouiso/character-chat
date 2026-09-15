import { useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { AuthenticatedImage } from "@/component/ui/authenticated-image";
import {
  createMemoryNote,
  deleteMemoryNote,
  listMemoryNotes,
  updateMemoryNote,
  type MemoryNote,
} from "@/lib/api";

import { OU2 } from "./ouse-tokens";

// 記憶（設計 D-3）: 彼女が覚えていること。書き換えれば、それが彼女の事実になる。
// 会話中の「覚えておく」がここに溜まる。書き換え・削除は即反映、彼女は気づかない。

interface OuMemoryScreenProps {
  characterId: string | null;
  characterName: string;
  characterAvatar?: string | null;
  onBack: () => void;
}

const memoryKey = (characterId: string | null) => ["memory-notes", characterId] as const;

const formatSource = (note: MemoryNote): string => {
  const date = new Date(note.createdAt);
  return `${date.getMonth() + 1}/${date.getDate()} の会話から`;
};

export const OuMemoryScreen = ({
  characterId,
  characterName,
  characterAvatar,
  onBack,
}: OuMemoryScreenProps) => {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  // 「忘れさせる」は取り消せない破壊操作なので、二度目のタップで初めて確定する
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const { data: notes = [] } = useQuery({
    queryKey: memoryKey(characterId),
    queryFn: () => listMemoryNotes(characterId),
    enabled: Boolean(characterId),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: memoryKey(characterId) });

  const updateMutation = useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) => updateMemoryNote(id, content),
    onSuccess: invalidate,
    // 失敗時に入力を消さず、書き換え内容を残したまま再試行できるようにする
    onError: () => toast.error("書き換えに失敗しました"),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteMemoryNote(id),
    onSuccess: invalidate,
    onError: () => toast.error("忘れさせられませんでした"),
  });
  const createMutation = useMutation({
    mutationFn: (input: { characterId: string; content: string }) => createMemoryNote(input),
    onSuccess: invalidate,
    // 失敗時に入力を消さず、覚えさせたい内容を残したまま再試行できるようにする
    onError: () => toast.error("覚えさせられませんでした"),
  });

  const beginEdit = (note: MemoryNote) => {
    setAdding(false);
    setConfirmingDeleteId(null);
    setEditingId(note.id);
    setDraft(note.content);
  };
  const commitEdit = () => {
    const content = draft.trim();
    if (!editingId || !content) return;
    // 成功時のみ入力を閉じる。失敗時は draft を残して再試行できるようにする
    updateMutation.mutate(
      { id: editingId, content },
      {
        onSuccess: () => {
          setEditingId(null);
          setDraft("");
        },
      },
    );
  };
  const commitAdd = () => {
    const content = draft.trim();
    if (!content || !characterId) return;
    createMutation.mutate(
      { characterId, content },
      {
        onSuccess: () => {
          setAdding(false);
          setDraft("");
        },
      },
    );
  };

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "14px 0 32px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 24px" }}>
        <button
          type="button"
          onClick={onBack}
          aria-label="もどる"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: 44,
            minHeight: 44,
            background: "none",
            border: "none",
            fontSize: 18,
            color: OU2.dim,
            cursor: "pointer",
          }}
        >
          ‹
        </button>
        <div
          style={{ flex: 1, fontFamily: OU2.serif, fontSize: 23, fontWeight: 600, color: OU2.text }}
        >
          記憶
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {characterAvatar && (
            <AuthenticatedImage
              src={characterAvatar}
              alt=""
              style={{ width: 30, height: 30, borderRadius: "50%", objectFit: "cover" }}
              // 認証フェッチ失敗時に円が消えてレイアウトが動かないよう同サイズの空円を表示する
              fallback={
                <div
                  aria-hidden
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: "50%",
                    background: "rgba(255,255,255,.08)",
                  }}
                />
              }
            />
          )}
          <span style={{ fontFamily: OU2.round, fontSize: 12.5, color: OU2.lamp }}>
            {characterName}
          </span>
        </div>
      </div>

      <p
        style={{
          padding: "6px 24px 12px",
          fontFamily: OU2.round,
          fontSize: 11.5,
          lineHeight: 1.7,
          color: OU2.faint,
        }}
      >
        彼女が覚えていること。
        <b style={{ color: OU2.dim }}>書き換えれば、それが彼女の事実になります。</b>
      </p>

      <div style={{ padding: "0 24px", display: "flex", flexDirection: "column", gap: 12 }}>
        {notes.map((note, index) => {
          const editing = editingId === note.id;
          const pinned = index === 0;
          return (
            <div
              key={note.id}
              style={{
                borderRadius: 18,
                border: `1px solid ${pinned ? OU2.lampDim : OU2.hairline}`,
                background: pinned ? "rgba(214,160,84,.1)" : "rgba(20,15,13,.35)",
                padding: "15px 16px",
              }}
            >
              {editing ? (
                <>
                  <div
                    style={{
                      fontFamily: OU2.round,
                      fontSize: 11,
                      letterSpacing: "0.16em",
                      color: OU2.lamp,
                      marginBottom: 8,
                    }}
                  >
                    書き換え中
                  </div>
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    autoFocus
                    rows={2}
                    aria-label="記憶を書き換える"
                    style={{
                      width: "100%",
                      resize: "vertical",
                      borderRadius: 13,
                      background: "rgba(20,15,13,.7)",
                      border: `1px solid ${OU2.lampDim}`,
                      padding: "11px 14px",
                      fontFamily: OU2.round,
                      fontSize: 13,
                      color: OU2.text,
                      outline: "none",
                    }}
                  />
                  <div style={{ display: "flex", gap: 9, marginTop: 11 }}>
                    <button
                      type="button"
                      onClick={commitEdit}
                      style={{
                        minWidth: 44,
                        minHeight: 44,
                        padding: "9px 18px",
                        borderRadius: 16,
                        border: "none",
                        background: OU2.lampGrad,
                        color: OU2.onLamp,
                        fontFamily: OU2.round,
                        fontSize: 11.5,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      これを事実にする
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(null);
                        setDraft("");
                      }}
                      style={{
                        minWidth: 44,
                        minHeight: 44,
                        padding: "9px 16px",
                        borderRadius: 16,
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
                </>
              ) : (
                <>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 9 }}>
                    <span
                      style={{ color: pinned ? OU2.lamp : OU2.faint, fontSize: 12, marginTop: 2 }}
                    >
                      ◆
                    </span>
                    <div
                      style={{
                        flex: 1,
                        fontFamily: OU2.round,
                        fontSize: 13,
                        lineHeight: 1.8,
                        color: OU2.text,
                      }}
                    >
                      {note.content}
                    </div>
                    {pinned && (
                      <span style={{ fontFamily: OU2.round, fontSize: 12, color: OU2.lamp }}>
                        ピン
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: 14,
                      marginTop: 9,
                      paddingLeft: 21,
                      fontFamily: OU2.round,
                      fontSize: 11,
                      color: OU2.faint,
                    }}
                  >
                    <span>{formatSource(note)}</span>
                    <button
                      type="button"
                      onClick={() => beginEdit(note)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        minWidth: 44,
                        minHeight: 44,
                        padding: "0 4px",
                        background: "none",
                        border: "none",
                        color: OU2.dim,
                        cursor: "pointer",
                      }}
                    >
                      書き換える
                    </button>
                    <button
                      type="button"
                      // 一度目は確定待ちに切り替え、二度目のタップで実際に削除する
                      onClick={() => {
                        if (confirmingDeleteId === note.id) {
                          deleteMutation.mutate(note.id);
                          setConfirmingDeleteId(null);
                        } else {
                          setConfirmingDeleteId(note.id);
                        }
                      }}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        minWidth: 44,
                        minHeight: 44,
                        padding: "0 4px",
                        background: "none",
                        border: "none",
                        color: confirmingDeleteId === note.id ? OU2.lamp : OU2.faint,
                        cursor: "pointer",
                      }}
                    >
                      {confirmingDeleteId === note.id ? "ほんとうに忘れさせる？" : "忘れさせる"}
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}

        {/* 覚えさせたいことを足す */}
        {adding ? (
          <div
            style={{
              borderRadius: 18,
              border: `1px solid ${OU2.lampDim}`,
              background: "rgba(20,15,13,.55)",
              padding: "15px 16px",
            }}
          >
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              autoFocus
              rows={2}
              aria-label="覚えさせたいこと"
              placeholder="はじめて会ったのは大学の図書館…"
              style={{
                width: "100%",
                resize: "vertical",
                borderRadius: 13,
                background: "rgba(20,15,13,.7)",
                border: `1px solid ${OU2.hairline}`,
                padding: "11px 14px",
                fontFamily: OU2.round,
                fontSize: 13,
                color: OU2.text,
                outline: "none",
              }}
            />
            <div style={{ display: "flex", gap: 9, marginTop: 11 }}>
              <button
                type="button"
                onClick={commitAdd}
                style={{
                  minWidth: 44,
                  minHeight: 44,
                  padding: "9px 18px",
                  borderRadius: 16,
                  border: "none",
                  background: OU2.lampGrad,
                  color: OU2.onLamp,
                  fontFamily: OU2.round,
                  fontSize: 11.5,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                これを事実にする
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  setDraft("");
                }}
                style={{
                  minWidth: 44,
                  minHeight: 44,
                  padding: "9px 16px",
                  borderRadius: 16,
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
        ) : (
          <button
            type="button"
            onClick={() => {
              setEditingId(null);
              setDraft("");
              // 追加開始でリスト外に出る間に arm 済みの削除確認を解除する（戻った直後の1タップ削除を防ぐ）
              setConfirmingDeleteId(null);
              setAdding(true);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "13px 4px",
              background: "none",
              border: "none",
              cursor: "pointer",
            }}
          >
            <span
              style={{
                width: 38,
                height: 38,
                borderRadius: "50%",
                border: `1px dashed ${OU2.lampDim}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 17,
                color: OU2.lamp,
              }}
            >
              ＋
            </span>
            <span style={{ fontFamily: OU2.round, fontSize: 13, color: OU2.dim }}>
              覚えさせたいことを足す
            </span>
          </button>
        )}

        <p
          style={{
            fontFamily: OU2.round,
            fontSize: 11,
            lineHeight: 1.75,
            color: OU2.faint,
            marginTop: 4,
          }}
        >
          会話中の「◆
          覚えておく」がここに溜まります。書き換え・削除は即反映。彼女は書き換えに気づきません。
        </p>
      </div>
    </div>
  );
};
