// 記憶を書き換えるシート（板 C）。本文・覚え方・固定・削除導線。
// 失敗しても打った文は残す。409（固定上限・版ずれ）・404（消えた）を出し分ける。
import { useRef, useState } from "react";

import {
  listMemories,
  MemoryRequestError,
  updateMemory,
  type Memory,
  type MemoryCategory,
} from "../lib/memories";

import { CATEGORIES, ConfirmCloseSheet } from "./memory-screen";

type EditPhase = "form" | "saving" | "missing";

type MemoryEditSheetProps = {
  characterId: string;
  characterName: string;
  memory: Memory;
  onClose: () => void;
  onSaved: (before: Memory, after: Memory) => void;
  onDeleteRequest: () => void;
  onMissing: () => void;
};

// 板の「N日前に覚えた」の出し方。今日・昨日はことばで、以降は日数で。
export const memoryAgeLabel = (createdAt: number, now = Date.now()): string => {
  const days = Math.floor((now - createdAt) / 86_400_000);
  if (days <= 0) return "きょう覚えた";
  if (days === 1) return "きのう覚えた";
  return `${days}日前に覚えた`;
};

export const MemoryEditSheet = ({
  characterId,
  characterName,
  memory: baseline,
  onClose,
  onSaved,
  onDeleteRequest,
  onMissing,
}: MemoryEditSheetProps) => {
  const [current, setCurrent] = useState(baseline);
  const [content, setContent] = useState(baseline.content);
  const [category, setCategory] = useState<MemoryCategory>(baseline.category);
  const [pinned, setPinned] = useState(baseline.pinned);
  const [phase, setPhase] = useState<EditPhase>("form");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const saving = useRef(false);

  const dirty =
    content !== current.content || category !== current.category || pinned !== current.pinned;

  const requestClose = () => {
    if (phase === "saving") return;
    if (dirty && !confirming) {
      setConfirming(true);
      return;
    }
    onClose();
  };

  // 版ずれ: 一覧から最新を読み直して基準を更新。見つからなければ「見つからない」面へ。
  const resync = async () => {
    try {
      const result = await listMemories(characterId, current.conversationId);
      const fresh = result.memories.find((entry) => entry.id === current.id);
      if (!fresh) {
        setPhase("missing");
        onMissing();
        return;
      }
      setCurrent(fresh);
      setError("別のところで書き換えられました。最新の内容を読み込みました。");
      setPhase("form");
    } catch {
      setError("記憶を保存できませんでした。");
      setPhase("form");
    }
  };

  const submit = async () => {
    if (saving.current) return;
    if (!dirty) {
      onClose();
      return;
    }
    saving.current = true;
    setPhase("saving");
    setError(null);
    try {
      const updated = await updateMemory(characterId, {
        memoryId: current.id,
        expectedRevision: current.revision,
        content: content.trim(),
        category,
        pinned,
      });
      onSaved(current, updated);
    } catch (cause) {
      const code = cause instanceof MemoryRequestError ? cause.code : null;
      if (code === "pin_limit") {
        setError("これ以上、記憶を固定できません");
        setPhase("form");
      } else if (code === "revision_conflict") {
        await resync();
      } else if (code === "not_found") {
        setPhase("missing");
        onMissing();
      } else {
        setError("記憶を保存できませんでした。");
        setPhase("form");
      }
    } finally {
      saving.current = false;
    }
  };

  return (
    <div className="v2-memory-sheet-overlay" onClick={requestClose}>
      <div
        className="v2-memory-sheet"
        role="dialog"
        aria-label="記憶を書き換える"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="v2-memory-sheet-grabber" />
        <div className="v2-memory-sheet-header">
          <h2 className="v2-memory-sheet-title">記憶を書き換える</h2>
          <button
            type="button"
            className="v2-memory-icon-button subtle"
            aria-label="閉じる"
            onClick={requestClose}
          >
            ×
          </button>
        </div>

        {phase === "missing" ? (
          <div className="v2-memory-notice-card">
            <span>この記憶が見つかりませんでした。</span>
            <button type="button" className="v2-memory-secondary" onClick={onClose}>
              もどる
            </button>
          </div>
        ) : (
          <>
            <p className="v2-memory-sheet-caption">
              {characterName}が{memoryAgeLabel(current.createdAt)}
            </p>
            <p className="v2-memory-label">本文</p>
            <textarea
              className={`v2-memory-textarea ${error ? "error" : ""}`}
              value={content}
              maxLength={500}
              aria-invalid={error !== null}
              onChange={(event) => setContent(event.target.value)}
            />
            <p className="v2-memory-label">覚え方</p>
            <div className="v2-memory-pills" role="radiogroup" aria-label="覚え方">
              {CATEGORIES.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  role="radio"
                  aria-checked={category === option.key}
                  className={`v2-memory-pill ${category === option.key ? "selected" : ""}`}
                  onClick={() => setCategory(option.key)}
                >
                  {option.pill}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="v2-memory-toggle"
              aria-pressed={pinned}
              onClick={() => setPinned((value) => !value)}
            >
              <span className="v2-memory-toggle-track">
                <span className="v2-memory-toggle-thumb" />
              </span>
              固定する
            </button>
            <p className="v2-memory-note">
              直した記憶は、次の返事から使われます。直す前の内容を再び自動で覚えることはありません。
            </p>
            <button type="button" className="v2-memory-delete-link" onClick={onDeleteRequest}>
              この記憶を削除
            </button>
            {error && <p className="v2-memory-error">{error}</p>}
            <button
              type="button"
              className="v2-memory-primary"
              disabled={phase === "saving" || !content.trim()}
              onClick={() => void submit()}
            >
              {phase === "saving" ? "保存しています…" : "保存"}
            </button>
          </>
        )}
      </div>
      {confirming && <ConfirmCloseSheet onDiscard={onClose} onBack={() => setConfirming(false)} />}
    </div>
  );
};
