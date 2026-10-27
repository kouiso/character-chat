import { useRef, useState } from "react";
import type { ReactNode } from "react";

import { CharacterEditor } from "./character-editor";
import { CharacterVersionHistory } from "./character-version-history";

import type {
  CharacterActionResult,
  CharacterEditorState,
  CharacterRestoreRequest,
  CharacterWriteRequest,
  EditableCharacter,
} from "../lib/character-contract";
import type { CharacterSheet } from "@v2/db";

import "./character-workspace.css";

export type CharacterTransport = {
  list: () => Promise<CharacterActionResult<{ actorKey: string; characters: EditableCharacter[] }>>;
  load: (id: string) => Promise<CharacterActionResult<CharacterEditorState>>;
  save: (input: CharacterWriteRequest) => Promise<CharacterActionResult<CharacterEditorState>>;
  restore: (input: CharacterRestoreRequest) => Promise<CharacterActionResult<CharacterEditorState>>;
};

type Editor = { kind: "new" } | { kind: "existing"; state: CharacterEditorState };

const editorDraftKey = (actorKey: string | null, editor: Editor | null): string | null => {
  if (!actorKey || !editor) return null;
  return `${actorKey}:${editor.kind === "new" ? "new" : `${editor.state.sheet.id}:${editor.state.revision}`}`;
};

const CharacterList = ({
  characters,
  busy,
  listState,
  onEdit,
}: {
  characters: EditableCharacter[];
  busy: boolean;
  listState?: (empty: boolean) => ReactNode;
  onEdit: (id: string) => Promise<void>;
}) => (
  <>
    {listState?.(characters.length === 0) ??
      (characters.length === 0 ? <p>キャラクターが登録されていません。</p> : null)}
    {characters.length > 0 && (
      <ul aria-label="会話できるキャラクター">
        {characters.map((item) => (
          <li key={item.id}>
            <a href={`/chat/${encodeURIComponent(item.id)}`}>{item.name}と話す</a>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void onEdit(item.id);
              }}
            >
              {item.name}を編集
            </button>
          </li>
        ))}
      </ul>
    )}
  </>
);

export const CharacterWorkspace = ({
  characters,
  transport,
  listState,
}: {
  characters: EditableCharacter[];
  transport: CharacterTransport;
  listState?: (empty: boolean) => ReactNode;
}) => {
  const [visible, setVisible] = useState(characters);
  const [previousCharacters, setPreviousCharacters] = useState(characters);
  // 再取得は編集中の入力を保って一覧だけ更新し、保存完了は最新の一覧へ合流させる。
  if (previousCharacters !== characters) {
    setPreviousCharacters(characters);
    setVisible(characters);
  }
  const [owned, setOwned] = useState<EditableCharacter[]>([]);
  const [actorKey, setActorKey] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmVersion, setConfirmVersion] = useState<number | null>(null);
  const requestId = useRef(0);
  const openTarget = useRef<string | undefined>(undefined);

  const acceptActor = (listed: Awaited<ReturnType<CharacterTransport["list"]>>) => {
    if (!listed.ok) {
      if (listed.code === "unauthorized") {
        setEditor(null);
        setActorKey(null);
        setOwned([]);
      }
      setError(listed.message);
      return false;
    }
    if (actorKey !== listed.data.actorKey) setEditor(null);
    setActorKey(listed.data.actorKey);
    setOwned(listed.data.characters);
    return true;
  };

  const open = async (id?: string) => {
    openTarget.current = id;
    const ticket = ++requestId.current;
    setBusy(true);
    setError("");
    setMessage("");
    setConfirmVersion(null);
    try {
      const listed = await transport.list();
      if (ticket !== requestId.current) return;
      if (!acceptActor(listed)) return;
      if (id) {
        const loaded = await transport.load(id);
        if (ticket !== requestId.current) return;
        if (!loaded.ok) {
          setError(loaded.message);
          return;
        }
        setEditor({ kind: "existing", state: loaded.data });
      } else {
        setEditor({ kind: "new" });
      }
    } catch {
      if (ticket === requestId.current) setError("読み込めませんでした。もう一度お試しください。");
    } finally {
      if (ticket === requestId.current) setBusy(false);
    }
  };

  const accept = (state: CharacterEditorState) => {
    openTarget.current = state.sheet.id;
    const item = { id: state.sheet.id, name: state.sheet.name };
    const update = (items: EditableCharacter[]) =>
      items.some((current) => current.id === item.id)
        ? items.map((current) => (current.id === item.id ? item : current))
        : [...items, item];
    setVisible(update);
    setOwned(update);
    setEditor({ kind: "existing", state });
  };

  const save = async (sheet: CharacterSheet) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await transport.save({
        sheet,
        expectedVersionId: editor?.kind === "existing" ? editor.state.currentVersionId : null,
        expectedRevision: editor?.kind === "existing" ? editor.state.revision : "",
      });
      if (!result.ok) throw new Error(result.message);
      accept(result.data);
      setMessage("保存しました。");
    } catch (failure) {
      const text =
        failure instanceof Error ? failure.message : "保存できませんでした。再度お試しください。";
      setError(text);
      throw new Error(text);
    } finally {
      setBusy(false);
    }
  };

  const restore = async (versionId: number) => {
    if (editor?.kind !== "existing") return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await transport.restore({
        characterId: editor.state.sheet.id,
        versionId,
        expectedVersionId: editor.state.currentVersionId,
        expectedRevision: editor.state.revision,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      accept(result.data);
      setConfirmVersion(null);
      setMessage("選んだ版に戻しました。次の会話からこの指示を使います。");
    } catch {
      setError("版を戻せませんでした。もう一度お試しください。");
    } finally {
      setBusy(false);
    }
  };

  const draftKey = editorDraftKey(actorKey, editor);

  return (
    <section className="character-workspace" aria-label="キャラクター管理">
      <h1>キャラクター</h1>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          void open();
        }}
      >
        キャラクターを作る
      </button>
      {busy && <p role="status">処理しています…</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void open(openTarget.current);
            }}
          >
            読み直す
          </button>
        </div>
      )}
      {message && <p role="status">{message}</p>}
      <CharacterList characters={visible} busy={busy} listState={listState} onEdit={open} />
      {owned.length > 0 && (
        <p>編集できるキャラクター: {owned.map((item) => item.name).join("、")}</p>
      )}
      {editor && draftKey && (
        <div>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setEditor(null);
              setConfirmVersion(null);
            }}
          >
            編集を閉じる
          </button>
          <fieldset disabled={busy} className="character-workspace-input">
            <legend>キャラクター設定</legend>
            <CharacterEditor
              key={draftKey}
              initial={editor.kind === "new" ? null : editor.state.sheet}
              draftKey={draftKey}
              onSave={save}
            />
          </fieldset>
          {editor.kind === "existing" && (
            <CharacterVersionHistory
              state={editor.state}
              busy={busy}
              confirmVersion={confirmVersion}
              onSelect={setConfirmVersion}
              onRestore={restore}
              onCancel={() => setConfirmVersion(null)}
            />
          )}
        </div>
      )}
    </section>
  );
};
