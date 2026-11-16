// 記憶の削除の確かめ（板 D / DeleteConfirm）。消す前に必ずもう一段挟む。
// 失敗したらシートは残し、行は画面から外さん（削除が確定してから外す）。
import { useRef, useState } from "react";

import { removeMemory, type Memory } from "../lib/memories";

type MemoryDeleteSheetProps = {
  characterId: string;
  memory: Memory;
  onCancel: () => void;
  onDeleted: (memory: Memory) => void;
};

export const MemoryDeleteSheet = ({
  characterId,
  memory,
  onCancel,
  onDeleted,
}: MemoryDeleteSheetProps) => {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const busy = useRef(false);

  const submit = async () => {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setError(false);
    try {
      await removeMemory(characterId, memory.id);
      onDeleted(memory);
    } catch {
      setError(true);
      setSaving(false);
    } finally {
      busy.current = false;
    }
  };

  return (
    <div className="v2-memory-sheet-overlay" onClick={saving ? undefined : onCancel}>
      <div
        className="v2-memory-sheet"
        role="alertdialog"
        aria-label="記憶の削除"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="v2-memory-sheet-grabber" />
        <h2 className="v2-memory-sheet-title">記憶の削除</h2>
        <p className="v2-memory-quote">{memory.content}</p>
        <p className="v2-memory-note">この記憶を消します。消したあと短い間だけ、元に戻せます。</p>
        {error && <p className="v2-memory-error">記憶を削除できませんでした。</p>}
        <div className="v2-memory-sheet-actions">
          <button
            type="button"
            className="v2-memory-secondary"
            disabled={saving}
            onClick={onCancel}
          >
            キャンセル
          </button>
          <button
            type="button"
            className="v2-memory-danger"
            disabled={saving}
            onClick={() => void submit()}
          >
            {saving ? "削除しています…" : "削除する"}
          </button>
        </div>
      </div>
    </div>
  );
};
