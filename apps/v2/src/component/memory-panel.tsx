import { useCallback, useEffect, useState } from "react";

import {
  addMemory,
  listMemories,
  removeMemory,
  resetAllMemories,
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

type ItemProps = {
  memory: Memory;
  busy: boolean;
  draft: string | undefined;
  onRun: (action: () => Promise<unknown>) => Promise<void>;
  onDraft: (id: string, content: string | undefined) => void;
  update: (id: string, patch: { pinned?: boolean; content?: string }) => Promise<unknown>;
  remove: (id: string) => Promise<unknown>;
};

const MemoryItem = ({ memory, busy, draft, onRun, onDraft, update, remove }: ItemProps) => (
  <li className={memory.pinned ? "v2-memory-pinned" : undefined}>
    <div className="v2-memory-meta">
      <span>{KIND_LABEL[memory.kind]}</span>
      {memory.supersededBy && (
        <span className="v2-memory-superseded">新しい記憶に置き換わった</span>
      )}
      <button
        type="button"
        disabled={busy}
        aria-pressed={memory.pinned}
        onClick={() => {
          void onRun(() => update(memory.id, { pinned: !memory.pinned }));
        }}
      >
        {memory.pinned ? "固定中" : "固定する"}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          void onRun(() => remove(memory.id));
        }}
      >
        消す
      </button>
    </div>
    <textarea
      aria-label="記憶の内容"
      value={draft ?? memory.content}
      disabled={busy}
      onChange={(event) => onDraft(memory.id, event.target.value)}
    />
    {draft !== undefined && draft !== memory.content && (
      <button
        type="button"
        disabled={busy || !draft.trim()}
        onClick={() => {
          void onRun(async () => {
            await update(memory.id, { content: draft });
            onDraft(memory.id, undefined);
          });
        }}
      >
        この内容で保存
      </button>
    )}
  </li>
);

type ResetProps = {
  busy: boolean;
  onReset: () => Promise<void>;
};

// 全消去は取り消せないので二段階確認にする（no-alert 回避・MiraiMind のリセット相当）。
const MemoryResetButton = ({ busy, onReset }: ResetProps) => {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <div className="v2-memory-reset">
        <p>このキャラの記憶をすべて消します。元に戻せません。</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void onReset().then(() => setConfirming(false));
          }}
        >
          本当にすべて消す
        </button>
        <button type="button" disabled={busy} onClick={() => setConfirming(false)}>
          やめる
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      className="v2-memory-reset"
      disabled={busy}
      onClick={() => setConfirming(true)}
    >
      記憶をすべてリセット
    </button>
  );
};

const MemoryAddForm = ({ busy, onAdd }: { busy: boolean; onAdd: (content: string) => void }) => {
  const [adding, setAdding] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!adding.trim()) return;
        onAdd(adding);
        setAdding("");
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
  );
};

type BodyProps = {
  characterId: string;
  memories: Memory[] | null;
  error: string | null;
  busy: boolean;
  draft: Record<string, string>;
  onRun: (action: () => Promise<unknown>) => Promise<void>;
  onDraft: (id: string, content: string | undefined) => void;
};

const MemoryPanelBody = ({
  characterId,
  memories,
  error,
  busy,
  draft,
  onRun,
  onDraft,
}: BodyProps) => (
  <div className="v2-memory-body">
    {error && <p role="alert">{error}</p>}
    {memories === null && !error && <p>読み込み中…</p>}
    {memories?.length === 0 && <p>記憶はまだありません。</p>}
    <ul>
      {memories?.map((memory) => (
        <MemoryItem
          key={memory.id}
          memory={memory}
          busy={busy}
          draft={draft[memory.id]}
          onRun={onRun}
          onDraft={onDraft}
          update={(id, patch) => updateMemory(characterId, id, patch)}
          remove={(id) => removeMemory(characterId, id)}
        />
      ))}
    </ul>
    <MemoryAddForm
      busy={busy}
      onAdd={(content) => {
        void onRun(() => addMemory(characterId, { content, kind: "fact" }));
      }}
    />
    {memories && memories.length > 0 && (
      <MemoryResetButton
        busy={busy}
        onReset={async () => {
          await onRun(() => resetAllMemories(characterId));
        }}
      />
    )}
  </div>
);

// 記憶の手直しパネル（RIT-92）。見る・直す・消す・固定・手で足す。
export const MemoryPanel = ({ characterId }: Props) => {
  const [open, setOpen] = useState(false);
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
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
  const runAction = (action: () => Promise<unknown>) => run(action);

  const setDraftFor = (id: string, content: string | undefined) =>
    setDraft((value) => {
      const next = { ...value };
      if (content === undefined) delete next[id];
      else next[id] = content;
      return next;
    });

  return (
    <section className="v2-memory">
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        記憶{open ? "を閉じる" : "を見る"}
      </button>
      {open && (
        <MemoryPanelBody
          characterId={characterId}
          memories={memories}
          error={error}
          busy={busy}
          draft={draft}
          onRun={runAction}
          onDraft={setDraftFor}
        />
      )}
    </section>
  );
};
