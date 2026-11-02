import { useEffect, useState } from "react";

import { MAX_MEMORY_LENGTH, type MemoryChange, type MemoryRecord } from "@v2/db/memory-contract";

import { memoryRequest } from "../lib/memory-session";

type Scope = { characterId: string; conversationId: string };
type MemoryRow = MemoryRecord & { deleted?: boolean };
const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "処理できませんでした。入力は残っています。再試行してください。";

const MemoryEditor = ({
  memory,
  busy,
  save,
  remove,
  dismiss,
}: {
  memory: MemoryRow;
  busy: boolean;
  save: (change: MemoryChange) => Promise<MemoryRecord>;
  remove: (memory: MemoryRecord) => Promise<void>;
  dismiss: () => void;
}) => {
  const [content, setContent] = useState(memory.content);
  const [pinned, setPinned] = useState(memory.pinned);
  const [revision, setRevision] = useState(memory.revision);
  const [error, setError] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const confirmDelete = async () => {
    setError("");
    try {
      await remove({ ...memory, revision });
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setConfirmingDelete(false);
    }
  };
  const submit = async () => {
    setError("");
    try {
      const changed = await save({ ...memory, content, pinned, revision });
      setContent(changed.content);
      setRevision(changed.revision);
    } catch (caught) {
      setError(errorText(caught));
    }
  };
  return (
    <li>
      <fieldset disabled={busy}>
        <legend>{memory.deleted ? "削除済みの記憶（入力を保持）" : "保存した記憶"}</legend>
        <label>
          内容
          <textarea
            aria-label="記憶の内容"
            value={content}
            maxLength={MAX_MEMORY_LENGTH}
            onChange={(event) => setContent(event.target.value)}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={pinned}
            onChange={(event) => setPinned(event.target.checked)}
          />
          固定する
        </label>
        <p>
          {content.length} / {MAX_MEMORY_LENGTH}字
        </p>
        {content.length > MAX_MEMORY_LENGTH && <p>保存前に1,000字以内に短くしてください。</p>}
        <button
          type="button"
          disabled={memory.deleted || !content.trim() || content.length > MAX_MEMORY_LENGTH}
          onClick={() => void submit()}
        >
          変更を保存
        </button>
        <button type="button" disabled={memory.deleted} onClick={() => setConfirmingDelete(true)}>
          削除
        </button>
        {confirmingDelete && (
          <div role="group" aria-label="削除の確認">
            <p>この記憶を削除しますか？過去の会話本文は残ります。</p>
            <button type="button" onClick={() => void confirmDelete()}>
              削除を確定
            </button>
            <button type="button" onClick={() => setConfirmingDelete(false)}>
              キャンセル
            </button>
          </div>
        )}
        {memory.deleted && (
          <div>
            <p>別の画面で削除されています。入力を残しているだけで、返信には使いません。</p>
            <button type="button" onClick={dismiss}>
              この入力を破棄
            </button>
          </div>
        )}
        {revision !== memory.revision && (
          <div>
            <p>保存済みの内容は別の画面で変わっています。</p>
            <details>
              <summary>最新の保存内容を見る</summary>
              <p>{memory.content}</p>
            </details>
            <button
              type="button"
              onClick={() => {
                setContent(memory.content);
                setPinned(memory.pinned);
                setRevision(memory.revision);
                setError("");
              }}
            >
              入力を最新の内容に置き換える
            </button>
          </div>
        )}
      </fieldset>
      {error && <p role="alert">{error}</p>}
    </li>
  );
};

export const MemoryPanel = ({ characterId, conversationId }: Scope) => {
  const [memories, setMemories] = useState<MemoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [newId, setNewId] = useState(() => crypto.randomUUID());
  const [content, setContent] = useState("");
  const [pinned, setPinned] = useState(false);
  const request = (method: string, body?: Parameters<typeof memoryRequest>[3]) =>
    memoryRequest(characterId, conversationId, method, body);

  useEffect(() => {
    let cancelled = false;
    void memoryRequest(characterId, conversationId, "GET").then(
      (rows) => {
        if (!cancelled) {
          setMemories(rows);
          setLoading(false);
        }
      },
      (caught: unknown) => {
        if (!cancelled) {
          setError(errorText(caught));
          setLoading(false);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [characterId, conversationId]);

  const refresh = async () => {
    setBusy(true);
    setError("");
    try {
      const current = await request("GET");
      const ids = new Set(current.map((memory) => memory.id));
      setMemories((previous) => [
        ...current,
        ...previous
          .filter((memory) => !ids.has(memory.id))
          .map((memory) => ({ ...memory, deleted: true })),
      ]);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  const save = async (change: MemoryChange) => {
    setBusy(true);
    try {
      const [changed] = await request("PUT", change);
      setMemories((rows) => rows.map((row) => (row.id === changed.id ? changed : row)));
      return changed;
    } finally {
      setBusy(false);
    }
  };
  const remove = async (memory: MemoryRecord) => {
    setBusy(true);
    try {
      await request("DELETE", { id: memory.id, revision: memory.revision });
      setMemories((rows) => rows.filter((row) => row.id !== memory.id));
    } finally {
      setBusy(false);
    }
  };
  const add = async () => {
    setBusy(true);
    setError("");
    try {
      const [created] = await request("POST", { id: newId, content, pinned, kind: "fact" });
      setMemories((rows) => [created, ...rows.filter((row) => row.id !== created.id)]);
      setContent("");
      setPinned(false);
      setNewId(crypto.randomUUID());
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="v2-memory-panel" aria-label="記憶の管理">
      <p>
        この会話の記憶だけを使います。固定したものから、次の送信時に最大2,000字分を読み直します。
      </p>
      <p>削除しても、過去の会話や要約に書かれた内容までは消えません。</p>
      <button type="button" disabled={busy || loading} onClick={() => void refresh()}>
        最新の内容を読み直す
      </button>
      {loading ? (
        <p role="status">記憶を読み込んでいます。</p>
      ) : (
        <>
          {memories.length === 0 && !error && <p>まだ記憶はありません。</p>}
          <ul aria-label="保存した記憶">
            {[...memories]
              .sort(
                (a, b) =>
                  Number(b.pinned) - Number(a.pinned) ||
                  b.updatedAt - a.updatedAt ||
                  b.id.localeCompare(a.id),
              )
              .map((memory) => (
                <MemoryEditor
                  key={memory.id}
                  memory={memory}
                  busy={busy}
                  save={save}
                  remove={remove}
                  dismiss={() => setMemories((rows) => rows.filter((row) => row.id !== memory.id))}
                />
              ))}
          </ul>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void add();
            }}
          >
            <fieldset disabled={busy}>
              <legend>記憶を手で追加する</legend>
              <label>
                新しい記憶
                <textarea
                  aria-label="新しい記憶"
                  value={content}
                  required
                  maxLength={MAX_MEMORY_LENGTH}
                  onChange={(event) => setContent(event.target.value)}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={pinned}
                  onChange={(event) => setPinned(event.target.checked)}
                />
                固定して追加
              </label>
              <button type="submit" disabled={!content.trim()}>
                追加
              </button>
            </fieldset>
          </form>
        </>
      )}
      {busy && <p role="status">処理しています。</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
};
