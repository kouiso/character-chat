import { useEffect, useState } from "react";

import { Link } from "@tanstack/react-router";

import { characterDraftKey } from "../lib/character-draft";
import {
  characterDetailSchema,
  characterPath,
  CharacterRequestError,
  requestCharacter,
  savedCharacterSchema,
  type CharacterDetail,
} from "../lib/character-editor";

import { CharacterForm } from "./character-form";

import type { CharacterContent } from "@v2/db/character-version";

const requestError = (error: unknown): string =>
  error instanceof CharacterRequestError
    ? error.message
    : "接続できませんでした。入力は残っています。接続を確認して再試行してください。";

const isEditingDisabled = (working: boolean, confirmAction: "reload" | null): boolean =>
  working || confirmAction !== null;

const CharacterActionConfirmation = ({
  action,
  disabled,
  onCancel,
  onConfirm,
}: {
  action: "reload" | null;
  disabled: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) =>
  action ? (
    <section role="alertdialog" aria-labelledby="character-confirm-title">
      <p id="character-confirm-title">
        入力中の下書きを削除して最新の設定を読み直します。よろしいですか？
      </p>
      <button type="button" disabled={disabled} onClick={onCancel}>
        キャンセル
      </button>
      <button type="button" disabled={disabled} onClick={onConfirm}>
        実行
      </button>
    </section>
  ) : null;

const VersionsLink = ({ characterId }: { characterId?: string }) =>
  characterId ? (
    <Link
      to="/characters/$id/versions"
      params={{ id: characterId }}
      className="v2-editor-versions-link"
    >
      前の設定
    </Link>
  ) : null;

// 編集対象の読み。作る側（characterId なし）は読まない。revisionKey を上げると読み直す。
const useCharacterDetail = (characterId: string | undefined, revisionKey: number) => {
  const [detail, setDetail] = useState<CharacterDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        if (characterId) {
          const character = await requestCharacter(
            characterPath(characterId),
            characterDetailSchema,
            {
              signal: controller.signal,
            },
          );
          if (controller.signal.aborted) return;
          setDetail(character);
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

  return { detail, loading, loadError };
};

// 作る・直すの保存先だけを畳む。本文の形は POST（作成）と PUT（revision 付き）で違う。
const saveCharacter = (
  characterId: string | undefined,
  content: CharacterContent,
  expectedRevision: number,
) =>
  requestCharacter(
    characterId ? characterPath(characterId) : "/api/characters",
    savedCharacterSchema,
    {
      method: characterId ? "PUT" : "POST",
      body: JSON.stringify(characterId ? { content, expectedRevision } : content),
    },
  );

export const CharacterEditor = ({
  characterId,
  ownerUserId,
  onSaved,
}: {
  characterId?: string;
  ownerUserId: string;
  onSaved: (id: string) => Promise<void>;
}) => {
  const [error, setError] = useState<string | null>(null);
  const [revisionKey, setRevisionKey] = useState(0);
  const [working, setWorking] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"reload" | null>(null);
  const editingDisabled = isEditingDisabled(working, confirmAction);
  const draftKey = characterDraftKey(ownerUserId, characterId);
  const { detail, loading, loadError } = useCharacterDetail(characterId, revisionKey);

  const save = async (content: CharacterContent, expectedRevision: number): Promise<boolean> => {
    setWorking(true);
    setError(null);
    try {
      const saved = await saveCharacter(characterId, content, expectedRevision);
      await onSaved(saved.id);
      return true;
    } catch (cause) {
      setError(requestError(cause));
      return false;
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
      {/* 版の一覧・戻しは専用の画面へ（板 Versions）。編集の画面は「ほか」の行から入る。 */}
      <VersionsLink characterId={characterId} />
      <CharacterActionConfirmation
        action={confirmAction}
        disabled={working}
        onCancel={() => setConfirmAction(null)}
        onConfirm={reload}
      />
    </>
  );
};
