import { useEffect, useState } from "react";

import { characterContentSchema, type CharacterContent } from "@v2/db/character-version";

import { readCharacterDraft, type CharacterDraft } from "../lib/character-draft";

export type CharacterFormValue = CharacterContent;

const EMPTY: CharacterFormValue = {
  name: "",
  bio: "",
  personality: "",
  speechStyle: "",
  appearance: "",
  background: "",
  worldSetting: "",
  prologue: "",
  greeting: "",
  privateNotes: "",
  memoryInstruction: "",
  memoryKinds: ["fact", "preference"],
  tags: [],
  voiceRef: null,
  avatarRef: null,
  visibility: "private",
};

type TextKey = Exclude<
  keyof CharacterFormValue,
  "tags" | "visibility" | "legacyReconstructed" | "memoryKinds"
>;
type Field = { key: TextKey; label: string; max: number; required?: boolean; multiline?: boolean };
const FIELDS: Field[] = [
  { key: "name", label: "名前", max: 80, required: true },
  { key: "bio", label: "紹介", max: 500, multiline: true },
  { key: "personality", label: "人格", max: 2000, required: true, multiline: true },
  { key: "speechStyle", label: "口調・話し方", max: 1000, required: true, multiline: true },
  { key: "greeting", label: "初回のひとこと", max: 2000, required: true, multiline: true },
  { key: "appearance", label: "外見", max: 4000, multiline: true },
  { key: "background", label: "背景", max: 4000, multiline: true },
  { key: "worldSetting", label: "世界設定", max: 4000, multiline: true },
  { key: "prologue", label: "プロローグ", max: 4000, multiline: true },
  {
    key: "privateNotes",
    label: "隠し設定（モデルには送信・共有画面には非表示）",
    max: 4000,
    multiline: true,
  },
  {
    key: "memoryInstruction",
    label: "記憶の指示（このキャラが何を覚えるか）",
    max: 2000,
    multiline: true,
  },
  { key: "voiceRef", label: "音声の参照ID", max: 200 },
  { key: "avatarRef", label: "アバターの参照", max: 500 },
];

export const CharacterForm = ({
  initial,
  revision,
  draftKey,
  onSubmit,
  disabled = false,
}: {
  initial?: CharacterFormValue;
  revision: number;
  draftKey: string;
  disabled?: boolean;
  onSubmit: (value: CharacterFormValue, expectedRevision: number) => Promise<boolean>;
}) => {
  const [draft, setDraft] = useState<CharacterDraft>(() => {
    try {
      const saved = readCharacterDraft(draftKey);
      if (saved) return saved;
    } catch {
      /* 端末保存が禁止されていても入力は続けられるようにする。 */
    }
    return {
      schemaVersion: 1,
      expectedRevision: revision,
      content: initial ?? EMPTY,
      tagsText: (initial?.tags ?? []).join("、"),
    };
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storageError, setStorageError] = useState(false);
  const [persist, setPersist] = useState(false);

  useEffect(() => {
    if (!persist) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify(draft));
    } catch {
      setStorageError(true);
    }
  }, [draftKey, draft, persist]);

  const change = (next: Partial<CharacterFormValue>) => {
    setPersist(true);
    setDraft((previous) => ({ ...previous, content: { ...previous.content, ...next } }));
  };
  const submit = async () => {
    const parsed = characterContentSchema.safeParse({
      ...draft.content,
      tags: draft.tagsText
        .split(/[\n,、]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
    });
    if (!parsed.success) {
      setError("入力内容を確認してください。必須項目・文字数・タグの上限を満たしていません。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (await onSubmit(parsed.data, draft.expectedRevision)) {
        setPersist(false);
        try {
          localStorage.removeItem(draftKey);
        } catch {
          setStorageError(true);
        }
      }
    } catch {
      setError("保存できませんでした。入力は残っています。再試行してください。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="v2-character-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <p className="v2-editor-note">
        入力はこの端末に下書き保存します。共有端末での利用には注意してください。
      </p>
      {storageError && (
        <p role="status">端末に下書きを保存できません。画面を閉じると未保存の入力が失われます。</p>
      )}
      {draft.expectedRevision !== revision && (
        <p role="alert">
          この下書きは古い版を元にしています。保存前に最新の内容を確認してください。
        </p>
      )}
      {draft.content.legacyReconstructed && (
        <p className="v2-editor-note">
          旧設定から再構成した版です。新しく保存する場合は、人格と口調を入力上限に合わせて整理してください。
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <fieldset disabled={busy || disabled}>
        {FIELDS.map((field) => (
          <label key={field.key}>
            <span>
              {field.label}
              {field.required ? "（必須）" : ""}・{field.max}文字まで
            </span>
            {field.multiline ? (
              <textarea
                aria-label={field.label}
                rows={3}
                required={field.required}
                value={draft.content[field.key] ?? ""}
                onChange={(event) => change({ [field.key]: event.target.value })}
              />
            ) : (
              <input
                aria-label={field.label}
                required={field.required}
                value={draft.content[field.key] ?? ""}
                onChange={(event) =>
                  change({
                    [field.key]:
                      event.target.value ||
                      (field.key === "voiceRef" || field.key === "avatarRef" ? null : ""),
                  })
                }
              />
            )}
          </label>
        ))}
        <fieldset className="v2-memory-kinds">
          <legend>覚える種類（両方外すと何も記憶しません）</legend>
          {(
            [
              ["fact", "事実"],
              ["preference", "好み"],
            ] as const
          ).map(([kind, label]) => (
            <label key={kind}>
              <input
                type="checkbox"
                aria-label={`記憶する種類: ${label}`}
                checked={draft.content.memoryKinds.includes(kind)}
                onChange={(event) =>
                  change({
                    memoryKinds: event.target.checked
                      ? [...draft.content.memoryKinds, kind]
                      : draft.content.memoryKinds.filter((item) => item !== kind),
                  })
                }
              />
              {label}
            </label>
          ))}
        </fieldset>
        <label>
          タグ（読点かカンマ区切り・5件まで、各30文字まで）
          <input
            aria-label="タグ"
            value={draft.tagsText}
            onChange={(event) => {
              setPersist(true);
              setDraft((previous) => ({ ...previous, tagsText: event.target.value }));
            }}
          />
        </label>
        <label>
          公開設定
          <select
            aria-label="公開設定"
            value={draft.content.visibility}
            onChange={(event) => {
              const visibility = event.target.value;
              if (visibility === "private" || visibility === "shared" || visibility === "public")
                change({ visibility });
            }}
          >
            <option value="private">非公開</option>
            <option value="shared">限定公開</option>
            <option value="public">公開</option>
          </select>
        </label>
        <p className="v2-editor-note">
          公開設定と音声の参照は保存のみです。この操作で外部へ公開したり音声を生成したりはしません。
        </p>
        <button type="submit">{busy ? "保存中…" : "保存して新しい会話を始める"}</button>
      </fieldset>
    </form>
  );
};
