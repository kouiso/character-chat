import { useEffect, useState } from "react";

import { storedCharacterContentSchema, type CharacterContent } from "@v2/db/character-version";
import { z } from "zod";

import { characterDraftKey } from "../lib/character-draft";
import {
  characterDetailSchema,
  characterPath,
  characterVersionsSchema,
  CharacterRequestError,
  requestCharacter,
  savedCharacterSchema,
  type CharacterDetail,
  type CharacterVersions,
} from "../lib/character-editor";

import { CharacterForm } from "./character-form";

const versionDetailSchema = z.object({ content: storedCharacterContentSchema });
const CONTENT_LABELS: [keyof CharacterContent, string][] = [
  ["name", "名前"],
  ["bio", "紹介"],
  ["personality", "人格"],
  ["speechStyle", "口調"],
  ["appearance", "外見"],
  ["background", "背景"],
  ["worldSetting", "世界設定"],
  ["prologue", "プロローグ"],
  ["greeting", "初回のひとこと"],
  ["privateNotes", "隠し設定"],
  ["tags", "タグ"],
  ["voiceRef", "音声の参照ID"],
  ["avatarRef", "アバターの参照"],
  ["visibility", "公開設定"],
];

const requestError = (error: unknown): string =>
  error instanceof CharacterRequestError
    ? error.message
    : "接続できませんでした。入力は残っています。接続を確認して再試行してください。";

const isEditingDisabled = (working: boolean, confirmAction: "restore" | "reload" | null): boolean =>
  working || confirmAction !== null;

type VersionPreview = { id: string; content: CharacterContent };

const CharacterVersionHistory = ({
  versions,
  preview,
  working,
  onShow,
  onRestore,
}: {
  versions: CharacterVersions | null;
  preview: VersionPreview | null;
  working: boolean;
  onShow: (id: string) => void;
  onRestore: () => void;
}) => {
  if (!versions) return null;
  return (
    <section aria-label="版の履歴" className="v2-version-history">
      <h2>版の履歴</h2>
      <ul>
        {versions.versions.map((version) => (
          <li key={version.id}>
            <span>
              版 {version.version}
              {version.id === versions.currentVersionId ? "（現在）" : ""} —{" "}
              {new Date(version.createdAt).toLocaleString("ja-JP")}
            </span>
            <button type="button" disabled={working} onClick={() => onShow(version.id)}>
              版 {version.version} の内容を見る
            </button>
          </li>
        ))}
      </ul>
      {preview && (
        <section aria-label="選んだ版の内容">
          <h3>選んだ版の内容</h3>
          {preview.content.legacyReconstructed && (
            <p>旧設定から再構成した版です。当時の履歴を完全に復元したものではありません。</p>
          )}
          <dl>
            {CONTENT_LABELS.map(([key, label]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>
                  {Array.isArray(preview.content[key])
                    ? preview.content[key].join("、")
                    : String(preview.content[key] ?? "—")}
                </dd>
              </div>
            ))}
          </dl>
          <button
            type="button"
            disabled={working || preview.id === versions.currentVersionId}
            onClick={onRestore}
          >
            この版に戻して新しい会話を始める
          </button>
        </section>
      )}
    </section>
  );
};

const CharacterActionConfirmation = ({
  action,
  disabled,
  onCancel,
  onConfirm,
}: {
  action: "restore" | "reload" | null;
  disabled: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) =>
  action ? (
    <section role="alertdialog" aria-labelledby="character-confirm-title">
      <p id="character-confirm-title">
        {action === "restore"
          ? "この版を現在の設定に戻します。入力中の下書きは削除し、新しい会話を始めます。過去の会話は変更しません。よろしいですか？"
          : "入力中の下書きを削除して最新の設定を読み直します。よろしいですか？"}
      </p>
      <button type="button" disabled={disabled} onClick={onCancel}>
        キャンセル
      </button>
      <button type="button" disabled={disabled} onClick={onConfirm}>
        実行
      </button>
    </section>
  ) : null;

export const CharacterEditor = ({
  characterId,
  ownerUserId,
  onSaved,
}: {
  characterId?: string;
  ownerUserId: string;
  onSaved: (id: string) => Promise<void>;
}) => {
  const [detail, setDetail] = useState<CharacterDetail | null>(null);
  const [versions, setVersions] = useState<CharacterVersions | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revisionKey, setRevisionKey] = useState(0);
  const [working, setWorking] = useState(false);
  const [preview, setPreview] = useState<{ id: string; content: CharacterContent } | null>(null);
  const [confirmAction, setConfirmAction] = useState<"restore" | "reload" | null>(null);
  const editingDisabled = isEditingDisabled(working, confirmAction);
  const draftKey = characterDraftKey(ownerUserId, characterId);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        if (characterId) {
          const path = characterPath(characterId);
          const [character, history] = await Promise.all([
            requestCharacter(path, characterDetailSchema, { signal: controller.signal }),
            requestCharacter(`${path}/versions`, characterVersionsSchema, {
              signal: controller.signal,
            }),
          ]);
          if (controller.signal.aborted) return;
          setDetail(character);
          setVersions(history);
        }
      } catch (cause) {
        if (!controller.signal.aborted) setLoadError(requestError(cause));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [characterId, revisionKey]);

  const save = async (content: CharacterContent, expectedRevision: number): Promise<boolean> => {
    setWorking(true);
    setError(null);
    try {
      const saved = await requestCharacter(
        characterId ? characterPath(characterId) : "/api/characters",
        savedCharacterSchema,
        {
          method: characterId ? "PUT" : "POST",
          body: JSON.stringify(characterId ? { content, expectedRevision } : content),
        },
      );
      await onSaved(saved.id);
      return true;
    } catch (cause) {
      setError(requestError(cause));
      return false;
    } finally {
      setWorking(false);
    }
  };

  const showVersion = async (versionId: string) => {
    if (!characterId) return;
    setWorking(true);
    setError(null);
    try {
      const version = await requestCharacter(
        `${characterPath(characterId)}/versions/${encodeURIComponent(versionId)}`,
        versionDetailSchema,
      );
      setPreview({ id: versionId, content: version.content });
    } catch (cause) {
      setError(requestError(cause));
    } finally {
      setWorking(false);
    }
  };

  const restore = async () => {
    if (!preview || !characterId || !detail) return;
    setConfirmAction(null);
    setWorking(true);
    setError(null);
    try {
      const saved = await requestCharacter(
        `${characterPath(characterId)}/restore`,
        savedCharacterSchema,
        {
          method: "POST",
          body: JSON.stringify({ versionId: preview.id, expectedRevision: detail.revision }),
        },
      );
      try {
        localStorage.removeItem(draftKey);
      } catch {
        /* 復元済みの版は端末保存の失敗で取り消せない。 */
      }
      await onSaved(saved.id);
    } catch (cause) {
      setError(requestError(cause));
    } finally {
      setWorking(false);
    }
  };

  const reload = () => {
    setConfirmAction(null);
    try {
      localStorage.removeItem(draftKey);
    } catch {
      setError("下書きを削除できませんでした。端末の保存設定を確認してください。");
      return;
    }
    setPreview(null);
    setError(null);
    setRevisionKey((value) => value + 1);
  };

  if (loading) return <p role="status">キャラクターを読み込んでいます…</p>;
  if (loadError)
    return (
      <div>
        <p role="alert">{loadError}</p>
        <button type="button" onClick={() => setRevisionKey((value) => value + 1)}>
          再試行
        </button>
      </div>
    );

  return (
    <>
      <h1>{characterId ? "キャラクターを編集" : "キャラクターを作る"}</h1>
      <p className="v2-editor-note">
        変更は新しい会話に反映します。すでに始めた会話の設定は変わりません。
      </p>
      {error && <p role="alert">{error}</p>}
      {characterId && (
        <button type="button" disabled={editingDisabled} onClick={() => setConfirmAction("reload")}>
          最新の内容を読み直す
        </button>
      )}
      <CharacterForm
        key={`${characterId ?? "new"}:${revisionKey}`}
        initial={detail?.content}
        revision={detail?.revision ?? 0}
        draftKey={draftKey}
        onSubmit={save}
        disabled={editingDisabled}
      />
      <CharacterVersionHistory
        versions={versions}
        preview={preview}
        working={editingDisabled}
        onShow={(id) => void showVersion(id)}
        onRestore={() => setConfirmAction("restore")}
      />
      <CharacterActionConfirmation
        action={confirmAction}
        disabled={working}
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => (confirmAction === "restore" ? void restore() : reload())}
      />
    </>
  );
};
