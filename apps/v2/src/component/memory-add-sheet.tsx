// 記憶を足すシート（板 B）。本文＋覚え方の4つ。押したら保存が終わるまで
// 二度押せない。会話が始まっとらん時は「トークへ」の案内に切り替わる。
import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";

import { addMemory, MemoryRequestError, type Memory, type MemoryCategory } from "../lib/memories";

import { CATEGORIES, ConfirmCloseSheet } from "./memory-screen";

type AddPhase = "form" | "saving" | "not_started";

type MemoryAddSheetProps = {
  characterId: string;
  conversationId: string | null;
  onClose: () => void;
  onAdded: (memory: Memory) => void;
};

export const MemoryAddSheet = ({
  characterId,
  conversationId,
  onClose,
  onAdded,
}: MemoryAddSheetProps) => {
  const [content, setContent] = useState("");
  const [category, setCategory] = useState<MemoryCategory>("long");
  const [phase, setPhase] = useState<AddPhase>("form");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  // 保存中の二度押しを promise ではなくフラグで塞ぐ（連打・Enter 連打対策）
  const saving = useRef(false);

  const dirty = content.trim().length > 0;
  const requestClose = () => {
    if (phase === "saving") return;
    if (dirty && !confirming) {
      setConfirming(true);
      return;
    }
    onClose();
  };

  const submit = async () => {
    if (saving.current) return;
    const text = content.trim();
    if (!text) return;
    saving.current = true;
    setPhase("saving");
    setError(null);
    try {
      const memory = await addMemory(characterId, {
        conversationId,
        content: text,
        category,
      });
      onAdded(memory);
    } catch (cause) {
      if (cause instanceof MemoryRequestError && cause.code === "conversation_not_started") {
        setPhase("not_started");
      } else {
        setError(
          cause instanceof MemoryRequestError && cause.code === "invalid_input"
            ? "内容を確認してください。"
            : "記憶を足せませんでした。",
        );
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
        aria-label="記憶を足す"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="v2-memory-sheet-grabber" />
        <div className="v2-memory-sheet-header">
          <h2 className="v2-memory-sheet-title">記憶を足す</h2>
          <button
            type="button"
            className="v2-memory-icon-button subtle"
            aria-label="閉じる"
            onClick={requestClose}
          >
            ×
          </button>
        </div>

        {phase === "not_started" ? (
          <div className="v2-memory-notice-card">
            <span>会話が始まると、記憶を足せます。</span>
            <Link
              to="/chat/$id"
              params={{ id: characterId }}
              className="v2-memory-primary"
              style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              トークへ
            </Link>
          </div>
        ) : (
          <>
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
            <p className="v2-memory-note">新しい記憶は「固定」が付きます。</p>
            {error && <p className="v2-memory-error">{error}</p>}
            <button
              type="button"
              className="v2-memory-primary"
              disabled={phase === "saving" || !content.trim()}
              onClick={() => void submit()}
            >
              {phase === "saving" ? "足しています…" : "記憶を足す"}
            </button>
          </>
        )}
      </div>
      {confirming && <ConfirmCloseSheet onDiscard={onClose} onBack={() => setConfirming(false)} />}
    </div>
  );
};
