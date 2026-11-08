import { useCallback, useEffect, useState } from "react";

import {
  addMemory,
  listMemories,
  removeMemory,
  updateMemory,
  MemoryRequestError,
  type Memory,
} from "../lib/memories";

type Props = {
  characterId: string;
};

const KIND_LABEL: Record<Memory["kind"], string> = {
  fact: "事実",
  summary: "要約",
  preference: "好み",
};

// 記憶の手直しパネル（RIT-92）。見る・直す・消す・固定・手で足す。
export const MemoryPanel = ({ characterId }: Props) => {
  const [open, setOpen] = useState(false);
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setMemories(await listMemories(characterId));
      setError(null);
    } catch {
      setError("記憶を読めませんでした。再試行してください。");
    }
  }, [characterId]);

  useEffect(() => {
    if (open && memories === null) void load();
  }, [open, memories, load]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      await load();
    } catch (cause) {
      setError(cause instanceof MemoryRequestError ? cause.message : "操作に失敗しました。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="v2-memory">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        記憶{open ? "を閉じる" : "を見る"}
      </button>
      {open && (
        <div className="v2-memory-body">
          {error && <p role="alert">{error}</p>}
          {memories === null && !error && <p>読み込み中…</p>}
          {memories?.length === 0 && <p>記憶はまだありません。</p>}
          <ul>
            {memories?.map((memory) => (
              <li key={memory.id} className={memory.pinned ? "v2-memory-pinned" : undefined}>
                <div className="v2-memory-meta">
                  <span>{KIND_LABEL[memory.kind]}</span>
                  <button
                    type="button"
                    disabled={busy}
                    aria-pressed={memory.pinned}
                    onClick={() =>
                      void run(() =>
                        updateMemory(characterId, memory.id, { pinned: !memory.pinned }),
                      )
                    }
                  >
                    {memory.pinned ? "固定中" : "固定する"}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(() => removeMemory(characterId, memory.id))
                    }
                  >
                    消す
                  </button>
                </div>
                <textarea
                  aria-label="記憶の内容"
                  value={draft[memory.id] ?? memory.content}
                  disabled={busy}
                  onChange={(event) =>
                    setDraft((value) => ({ ...value, [memory.id]: event.target.value }))
                  }
                />
                {draft[memory.id] !== undefined && draft[memory.id] !== memory.content && (
                  <button
                    type="button"
                    disabled={busy || !draft[memory.id].trim()}
                    onClick={() =>
                      void run(async () => {
                        await updateMemory(characterId, memory.id, {
                          content: draft[memory.id],
                        });
                        setDraft((value) => {
                          const next = { ...value };
                          delete next[memory.id];
                          return next;
                        });
                      })
                    }
                  >
                    この内容で保存
                  </button>
                )}
              </li>
            ))}
          </ul>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!adding.trim()) return;
              void run(async () => {
                await addMemory(characterId, { content: adding, kind: "fact" });
                setAdding("");
              });
            }}
          >
            <label>
              記憶を足す
              <textarea
                value={adding}
                disabled={busy}
                maxLength={4000}
                onChange={(event) => setAdding(event.target.value)}
              />
            </label>
            <button type="submit" disabled={busy || !adding.trim()}>
              追加する
            </button>
          </form>
        </div>
      )}
    </section>
  );
};
