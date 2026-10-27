import { useId, useState, useSyncExternalStore } from "react";
import type { ChangeEvent, FormEvent } from "react";

import {
  clearCharacterDraft,
  createCharacterDraft,
  createDraftFromIdea,
  loadCharacterDraft,
  persistCharacterDraft,
  validateCharacterDraft,
} from "../lib/character-draft";

import type { CharacterDraft, CharacterDraftErrors } from "../lib/character-draft";
import type { CharacterSheet } from "@v2/db";

import "./character-editor.css";

export type CharacterEditorProps = {
  initial: CharacterSheet | null;
  draftKey: string;
  onSave: (sheet: CharacterSheet) => Promise<void>;
};

const noop = () => undefined;
const subscribe = () => noop;
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

const getStorage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const CharacterEditorForm = ({ initial, draftKey, onSave }: CharacterEditorProps) => {
  const id = useId();
  const [storage] = useState(getStorage);
  const [restored] = useState(() => loadCharacterDraft(storage, draftKey, initial));
  const [draft, setDraft] = useState(() => restored.draft ?? createCharacterDraft(initial));
  const [errors, setErrors] = useState<CharacterDraftErrors>({});
  const [storageError, setStorageError] = useState(restored.error);
  const [storageStatus, setStorageStatus] = useState(
    restored.draft ? "保存した下書きを復元しました。" : "",
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  const updateDraft = (next: CharacterDraft) => {
    setDraft(next);
    setSaved(false);
    const error = persistCharacterDraft(storage, draftKey, initial, next);
    setStorageError(error);
    setStorageStatus(error ? "" : "下書きをこの端末に保存しました。");
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const result = validateCharacterDraft(draft, initial);
    setErrors(result.errors ?? {});
    setSaved(false);
    if (!result.sheet) return;
    setPending(true);
    setSaveError(null);
    try {
      await onSave(result.sheet);
      setSaved(true);
      setStorageError(clearCharacterDraft(storage, draftKey));
      setStorageStatus("");
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "保存できませんでした。再試行してください。",
      );
    } finally {
      setPending(false);
    }
  };

  const textField = (
    field:
      | "name"
      | "introduction"
      | "tags"
      | "greeting"
      | "systemPrompt"
      | "exampleDialogue"
      | "world"
      | "appearance"
      | "age"
      | "intervalMinutes"
      | "avatar"
      | "gender"
      | "slug",
    label: string,
    multiline = false,
  ) => {
    const fieldId = `${id}-${field}`;
    const common = {
      id: fieldId,
      value: draft[field],
      "aria-invalid": Boolean(errors[field]),
      "aria-describedby": errors[field] ? `${fieldId}-error` : undefined,
      onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        updateDraft({ ...draft, [field]: event.target.value }),
    };
    return (
      <div className="character-editor-field" key={field}>
        <label htmlFor={fieldId}>{label}</label>
        {multiline ? (
          <textarea {...common} rows={3} />
        ) : (
          <input
            {...common}
            type="text"
            inputMode={field === "age" || field === "intervalMinutes" ? "numeric" : undefined}
          />
        )}
        {errors[field] && (
          <p className="character-editor-error" id={`${fieldId}-error`}>
            {errors[field]}
          </p>
        )}
      </div>
    );
  };

  return (
    <form className="character-editor" onSubmit={(event) => void submit(event)} noValidate>
      <h2>{initial ? "キャラクターを編集" : "キャラクターを作成"}</h2>
      <fieldset disabled={pending}>
        <legend>短い案から始める</legend>
        <label htmlFor={`${id}-idea`}>短い案</label>
        <textarea
          id={`${id}-idea`}
          value={draft.idea}
          onChange={(event) => updateDraft({ ...draft, idea: event.target.value })}
          rows={2}
        />
        <p>案をもとに空欄だけを埋めます。入力済みの内容と年齢は変えません。</p>
        <button
          type="button"
          disabled={!draft.idea.trim()}
          onClick={() => updateDraft(createDraftFromIdea(draft, draft.idea))}
        >
          空欄に下書きを作る
        </button>
      </fieldset>
      <fieldset disabled={pending}>
        <legend>キャラクター設定</legend>
        {textField("name", "名前")}
        {textField("introduction", "紹介", true)}
        {textField("tags", "タグ（1行に1つ）", true)}
        {textField("greeting", "最初のひとこと", true)}
        {textField("systemPrompt", "指示", true)}
        {textField("exampleDialogue", "例文", true)}
        {textField("world", "世界", true)}
        {textField("appearance", "見た目", true)}
        {textField("age", "年齢（18歳以上）")}
        <div className="character-editor-field">
          <label htmlFor={`${id}-adult-category`}>区分</label>
          <select
            id={`${id}-adult-category`}
            value={draft.adultCategory}
            onChange={(event) =>
              updateDraft({
                ...draft,
                adultCategory: event.target.value === "adult" ? "adult" : "general",
              })
            }
          >
            <option value="general">一般</option>
            <option value="adult">成人向け</option>
          </select>
        </div>
        <label className="character-editor-checkbox">
          <input
            type="checkbox"
            checked={draft.proactiveEnabled}
            onChange={(event) => updateDraft({ ...draft, proactiveEnabled: event.target.checked })}
          />
          話しかけ設定を有効にする
        </label>
        {textField("intervalMinutes", "話しかける間隔（分）")}
        {textField("avatar", "画像URL（任意）")}
        {textField("gender", "性別（任意）")}
        {textField("slug", "識別名（任意）")}
      </fieldset>
      {Object.keys(errors).length > 0 && <p role="alert">入力内容を確認してください。</p>}
      {storageError && (
        <p role="alert" className="character-editor-error">
          {storageError}
        </p>
      )}
      {storageStatus && <p role="status">{storageStatus}</p>}
      {saveError && (
        <p role="alert" className="character-editor-error">
          {saveError}
        </p>
      )}
      {saved && <p role="status">キャラクターを保存しました。</p>}
      <button type="submit" disabled={pending}>
        {pending ? "保存中…" : "保存する"}
      </button>
    </form>
  );
};

// 端末の下書きはサーバに無いため、hydration が済んでから入力欄を復元する。
export const CharacterEditor = (props: CharacterEditorProps) => {
  const ready = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
  return ready ? (
    <CharacterEditorForm {...props} />
  ) : (
    <p role="status">入力フォームを準備しています。</p>
  );
};
