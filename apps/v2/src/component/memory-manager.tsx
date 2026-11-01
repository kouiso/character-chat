import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import {
  loadMemoryHistory,
  loadMemorySnapshot,
  MemoryRequestError,
  sendMemoryCommand,
} from "../lib/memory-client";

import "./memory-manager.css";

import type { ManagedMemory, MemoryCommand, MemorySnapshot } from "@v2/db";

export type MemoryManagerProps = { conversationId: string; endpoint?: string };

const messageOf = (error: unknown): string =>
  error instanceof MemoryRequestError
    ? error.message
    : "記憶を読み書きできません。接続を確認して再試行してください。";

const memoryStatus = (memory: ManagedMemory, enabled: boolean): string => {
  if (memory.state === "deleted") return "削除済み";
  if (memory.supersededById) return "訂正前の記憶";
  if (memory.state === "invalidated") return "出典が更新されたため利用対象外";
  if (!enabled || !memory.enabled) return "保存済み・利用停止中";
  if (!memory.eligible) return "次回の会話では利用対象外";
  return "次回の会話で利用可能";
};

const isDeletionUnconfirmed = (snapshot: MemorySnapshot, id: string): boolean =>
  snapshot.memories.some((memory) => memory.id === id && memory.state !== "deleted");

const visibleContent = (memory: ManagedMemory): string =>
  memory.state === "deleted" ? "削除した内容は表示しません。" : memory.content;

type MemoryFeedbackProps = {
  error: string | null;
  loading: boolean;
  saving: boolean;
  pending: MemoryCommand | null;
  reload: () => void;
  retry: (command: MemoryCommand) => void;
};
const MemoryFeedback = ({
  error,
  loading,
  saving,
  pending,
  reload,
  retry,
}: MemoryFeedbackProps) => (
  <>
    {error && (
      <div role="alert">
        <p>{error}</p>
        <button type="button" disabled={loading || saving} onClick={reload}>
          再読み込み
        </button>
        {pending && (
          <button type="button" disabled={loading || saving} onClick={() => retry(pending)}>
            操作を再試行
          </button>
        )}
      </div>
    )}
    {loading && <p role="status">記憶を読み込んでいます…</p>}
    {saving && <p role="status">保存しています…</p>}
  </>
);
type MemoryHistoryPanelProps = {
  history: { id: string; memories: ManagedMemory[] } | null;
  loading: boolean;
  enabled: boolean;
  close: () => void;
};
const MemoryHistoryPanel = ({ history, loading, enabled, close }: MemoryHistoryPanelProps) => (
  <>
    {loading && <p role="status">履歴を読み込んでいます…</p>}
    {history && (
      <section aria-label="記憶の履歴">
        <h2>記憶の履歴</h2>
        <ol>
          {history.memories.map((memory) => (
            <li key={memory.id}>
              <p>{visibleContent(memory)}</p>
              <p>{memoryStatus(memory, enabled)}</p>
            </li>
          ))}
        </ol>
        <button type="button" onClick={close}>
          履歴を閉じる
        </button>
      </section>
    )}
  </>
);
const MemoryManagerView = ({ target }: { target: string }) => {
  const [snapshot, setSnapshot] = useState<MemorySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<MemoryCommand | null>(null);
  const [newContent, setNewContent] = useState("");
  const [newKind, setNewKind] = useState<ManagedMemory["kind"]>("fact");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [uncertainDeleteIds, setUncertainDeleteIds] = useState<Set<string>>(() => new Set());
  const [history, setHistory] = useState<{ id: string; memories: ManagedMemory[] } | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const session = useRef(0);
  const operation = useRef<object | null>(null);

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const currentSession = session.current;
      const canCommit = () => !signal?.aborted && currentSession === session.current;
      setLoading(true);
      setError(null);
      try {
        const result = await loadMemorySnapshot(target, signal);
        if (canCommit()) {
          setSnapshot(result);
          setUncertainDeleteIds(
            (ids) => new Set([...ids].filter((id) => isDeletionUnconfirmed(result, id))),
          );
          setPending((command) =>
            command?.action === "delete" && !isDeletionUnconfirmed(result, command.id)
              ? null
              : command,
          );
        }
      } catch (caught) {
        if (canCommit()) setError(messageOf(caught));
      } finally {
        if (canCommit()) setLoading(false);
      }
    },
    [target],
  );

  const reload = useCallback(
    async (signal?: AbortSignal) => {
      if (operation.current) return;
      const currentOperation = {};
      operation.current = currentOperation;
      try {
        await refresh(signal);
      } finally {
        if (operation.current === currentOperation) operation.current = null;
      }
    },
    [refresh],
  );

  useEffect(() => {
    const controller = new AbortController();
    session.current += 1;
    setSnapshot(null);
    setNewContent("");
    setEditContent("");
    setPending(null);
    setEditingId(null);
    setDeletingId(null);
    setHistory(null);
    setSaving(false);
    setHistoryLoading(false);
    void reload(controller.signal);
    return () => {
      session.current += 1;
      controller.abort();
      operation.current = null;
    };
  }, [reload]);

  const mutate = async (command: MemoryCommand) => {
    // 読込中の変更が読込の完了処理だけを無効にし、再試行不能になるのを防ぐ。
    if (operation.current) return;
    const currentOperation = {};
    operation.current = currentOperation;
    const currentSession = ++session.current;
    setSaving(true);
    setError(null);
    setPending(command);
    setHistory(null);
    setHistoryLoading(false);
    if (command.action === "delete") {
      setUncertainDeleteIds((ids) => new Set(ids).add(command.id));
      setDeletingId(null);
      setEditingId(null);
      setEditContent("");
    }
    try {
      await sendMemoryCommand(target, command);
      if (currentSession !== session.current) return;
      setSnapshot(null);
      setPending(command.action === "delete" ? command : null);
      setEditingId(null);
      setDeletingId(null);
      setHistory(null);
      if (command.action === "add") setNewContent("");
      await refresh();
    } catch (caught) {
      if (currentSession === session.current) setError(messageOf(caught));
    } finally {
      if (operation.current === currentOperation) operation.current = null;
      if (currentSession === session.current) setSaving(false);
    }
  };

  const showHistory = async (id: string) => {
    const currentSession = session.current;
    setHistoryLoading(true);
    setError(null);
    try {
      const memories = await loadMemoryHistory(target, id);
      if (currentSession === session.current) setHistory({ id, memories });
    } catch (caught) {
      if (currentSession === session.current) setError(messageOf(caught));
    } finally {
      if (currentSession === session.current) setHistoryLoading(false);
    }
  };

  const add = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void mutate({
      action: "add",
      requestKey:
        pending?.action === "add" && pending.kind === newKind && pending.content === newContent
          ? pending.requestKey
          : crypto.randomUUID(),
      kind: newKind,
      content: newContent,
    });
  };
  const busy = loading || saving;

  return (
    <section className="memory-manager" aria-label="記憶の管理" aria-busy={busy}>
      <h1>記憶の管理</h1>
      <p>保存した内容と、次回の会話で利用する内容を確認できます。</p>
      <MemoryFeedback
        error={error}
        loading={loading}
        saving={saving}
        pending={pending}
        reload={() => void reload()}
        retry={(command) => void mutate(command)}
      />
      {snapshot && (
        <>
          <label className="memory-manager-toggle">
            <input
              type="checkbox"
              checked={snapshot.enabled}
              disabled={busy}
              onChange={(event) =>
                void mutate({ action: "set-enabled", enabled: event.target.checked })
              }
            />
            記憶を利用する
          </label>
          {!snapshot.enabled && (
            <p>保存済みの記憶は残ります。記憶の参照と自動追加を停止しています。</p>
          )}
          <form aria-label="記憶を追加" onSubmit={add}>
            <h2>記憶を追加</h2>
            <label>
              種類
              <select
                value={newKind}
                disabled={busy}
                onChange={(event) => {
                  const kind = event.target.value;
                  if (kind === "fact" || kind === "preference" || kind === "summary")
                    setNewKind(kind);
                }}
              >
                <option value="fact">事実</option>
                <option value="preference">好み</option>
                <option value="summary">要約</option>
              </select>
            </label>
            <label>
              覚えておく内容
              <textarea
                value={newContent}
                onChange={(event) => setNewContent(event.target.value)}
                disabled={busy}
                rows={3}
              />
            </label>
            <button type="submit" disabled={busy || newContent.trim().length === 0}>
              追加する
            </button>
          </form>
          <h2>保存済みの記憶</h2>
          {uncertainDeleteIds.size > 0 && (
            <div role="status">
              <p>削除状態を確認中です。確認できるまで対象の内容を表示しません。</p>
              <button type="button" disabled={busy} onClick={() => void reload()}>
                削除状態を再読み込み
              </button>
              {[...uncertainDeleteIds].map((id) => (
                <button
                  key={id}
                  type="button"
                  disabled={busy}
                  onClick={() => void mutate({ action: "delete", id })}
                >
                  削除を再試行
                </button>
              ))}
            </div>
          )}
          {snapshot.memories.length === 0 && <p>保存済みの記憶はありません。</p>}
          <ul className="memory-manager-list">
            {snapshot.memories
              .filter((memory) => !uncertainDeleteIds.has(memory.id))
              .map((memory) => (
                <li key={memory.id}>
                  <p>{visibleContent(memory)}</p>
                  <p>{memoryStatus(memory, snapshot.enabled)}</p>
                  <p>
                    {memory.sourceType === "user"
                      ? "手入力"
                      : `会話由来${memory.sourceRevision === null ? "" : `・版 ${memory.sourceRevision}`}`}
                  </p>
                  <button
                    type="button"
                    disabled={busy || historyLoading}
                    onClick={() => void showHistory(memory.id)}
                  >
                    履歴
                  </button>
                  {memory.state !== "deleted" && (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setEditingId(memory.id);
                          setEditContent(memory.content);
                        }}
                      >
                        訂正
                      </button>
                      <button
                        type="button"
                        aria-pressed={memory.pinned}
                        disabled={busy}
                        onClick={() =>
                          void mutate({ action: "pin", id: memory.id, pinned: !memory.pinned })
                        }
                      >
                        ピン留め
                      </button>
                      <label className="memory-manager-toggle">
                        <input
                          type="checkbox"
                          checked={memory.enabled}
                          disabled={busy || memory.state !== "active"}
                          onChange={(event) =>
                            void mutate({
                              action: "enable",
                              id: memory.id,
                              enabled: event.target.checked,
                            })
                          }
                        />
                        この記憶を利用
                      </label>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setDeletingId(memory.id)}
                      >
                        削除
                      </button>
                    </>
                  )}
                  {editingId === memory.id && (
                    <form
                      aria-label="記憶を訂正"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void mutate({
                          action: "edit",
                          requestKey:
                            pending?.action === "edit" &&
                            pending.id === memory.id &&
                            pending.content === editContent
                              ? pending.requestKey
                              : crypto.randomUUID(),
                          id: memory.id,
                          content: editContent,
                        });
                      }}
                    >
                      <label>
                        訂正後の内容
                        <textarea
                          value={editContent}
                          onChange={(event) => setEditContent(event.target.value)}
                          disabled={busy}
                          rows={3}
                        />
                      </label>
                      <button type="submit" disabled={busy || editContent.trim().length === 0}>
                        訂正を保存
                      </button>
                      <button type="button" disabled={busy} onClick={() => setEditingId(null)}>
                        キャンセル
                      </button>
                    </form>
                  )}
                  {deletingId === memory.id && (
                    <div role="group" aria-label="削除の確認">
                      <p>この記憶を削除しますか？ 削除後は会話で利用しません。</p>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void mutate({ action: "delete", id: memory.id })}
                      >
                        削除する
                      </button>
                      <button type="button" disabled={busy} onClick={() => setDeletingId(null)}>
                        キャンセル
                      </button>
                    </div>
                  )}
                </li>
              ))}
          </ul>
          <MemoryHistoryPanel
            history={history}
            loading={historyLoading}
            enabled={snapshot.enabled}
            close={() => setHistory(null)}
          />
        </>
      )}
    </section>
  );
};

export const MemoryManager = ({ conversationId, endpoint }: MemoryManagerProps) => {
  const target = endpoint ?? `/api/memory/${encodeURIComponent(conversationId)}`;
  return <MemoryManagerView key={target} target={target} />;
};
