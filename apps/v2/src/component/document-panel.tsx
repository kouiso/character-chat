import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  deleteDocument,
  DocumentClientError,
  listDocuments,
  parseDocumentBudget,
  setDocumentBudget,
  updateDocument,
  uploadDocument,
} from "../lib/document-client";

import type { DocumentClientScope, DocumentItem, DocumentListing } from "../lib/document-client";

import "./document-panel.css";

export type DocumentPanelProps = { characterId: string; conversationId: string | null };

const messageOf = (error: unknown): string =>
  error instanceof DocumentClientError
    ? error.message
    : "資料を操作できません。通信を確認して再試行してください";

const activeSignal = (
  controller: AbortController | null,
  busy: boolean,
): AbortSignal | undefined =>
  controller && !controller.signal.aborted && !busy ? controller.signal : undefined;

const DocumentFailure = ({
  message,
  busy,
  canRecover,
  onReload,
  onRecover,
}: {
  message: string;
  busy: boolean;
  canRecover: boolean;
  onReload: () => void;
  onRecover: () => void;
}) => {
  if (!message) return null;
  return (
    <div role="alert">
      <p>{message}</p>
      <button type="button" disabled={busy} onClick={onReload}>
        資料を読み直す
      </button>
      {canRecover && (
        <button type="button" disabled={busy} onClick={onRecover}>
          失敗した資料の削除を再試行
        </button>
      )}
    </div>
  );
};

const DocumentRow = ({
  document,
  busy,
  onToggle,
  onBudget,
  onRemove,
}: {
  document: DocumentItem;
  busy: boolean;
  onToggle: (id: string, enabled: boolean) => void;
  onBudget: (id: string, budget: string) => void;
  onRemove: (id: string) => void;
}) => {
  const [budget, setBudget] = useState(String(document.budgetChars));
  const ready = document.status === "ready";
  return (
    <li className="document-row">
      <h4>{document.name}</h4>
      {!ready && <p>取り込み中です。停止した場合は削除してやり直せます。</p>}
      <label className="document-toggle">
        <input
          type="checkbox"
          checked={document.enabled}
          disabled={busy || !ready}
          onChange={(event) => onToggle(document.id, event.currentTarget.checked)}
        />
        {document.name}を参照する
      </label>
      <form
        className="document-budget"
        onSubmit={(event) => {
          event.preventDefault();
          onBudget(document.id, budget);
        }}
      >
        <label>
          {document.name}の字数上限
          <input
            type="number"
            min="0"
            max="100000"
            step="1"
            inputMode="numeric"
            value={budget}
            disabled={busy || !ready}
            onChange={(event) => setBudget(event.currentTarget.value)}
          />
        </label>
        <button type="submit" disabled={busy || !ready}>
          字数を保存
        </button>
      </form>
      <button
        type="button"
        className="document-delete"
        disabled={busy}
        aria-label={`${document.name}を削除`}
        onClick={() => onRemove(document.id)}
      >
        削除
      </button>
    </li>
  );
};

const ScopedDocumentPanel = ({ characterId, conversationId }: DocumentClientScope) => {
  const scope = useMemo(() => ({ characterId, conversationId }), [characterId, conversationId]);
  const lifetime = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const [snapshot, setSnapshot] = useState<DocumentListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [recoveryId, setRecoveryId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [totalBudget, setTotalBudget] = useState("4000");

  const reload = useCallback(
    async (signal: AbortSignal) => {
      const next = await listDocuments(scope, signal);
      if (signal.aborted) return;
      setSnapshot(next);
      setTotalBudget(String(next.settings.budgetChars));
    },
    [scope],
  );

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    void reload(controller.signal)
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(messageOf(failure));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reload]);

  const retry = () => {
    const signal = activeSignal(lifetime.current, busyRef.current);
    if (!signal) return;
    busyRef.current = true;
    setBusy(true);
    setLoading(true);
    setError("");
    void reload(signal)
      .catch((failure: unknown) => {
        if (!signal.aborted) setError(messageOf(failure));
      })
      .finally(() => {
        busyRef.current = false;
        if (!signal.aborted) {
          setBusy(false);
          setLoading(false);
        }
      });
  };

  const run = async (
    action: (signal: AbortSignal) => Promise<void>,
    success: string,
    after?: () => void,
  ) => {
    const signal = activeSignal(lifetime.current, busyRef.current);
    if (!signal) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    setRecoveryId(null);
    try {
      await action(signal);
      if (signal.aborted) return;
      await reload(signal);
      if (signal.aborted) return;
      after?.();
      setNotice(success);
    } catch (failure) {
      if (signal.aborted) return;
      setError(messageOf(failure));
      if (failure instanceof DocumentClientError) setRecoveryId(failure.documentId ?? null);
      // 取り込み失敗後もindexing行を表示し、削除による枠回復を可能にする。
      await reload(signal).catch(() => undefined);
    } finally {
      busyRef.current = false;
      if (!signal.aborted) setBusy(false);
    }
  };

  if (loading && !snapshot) return <p role="status">資料を読み込んでいます。</p>;
  return (
    <div>
      <DocumentFailure
        message={error}
        busy={busy || loading}
        canRecover={recoveryId !== null}
        onReload={retry}
        onRecover={() => {
          if (recoveryId)
            void run((signal) => deleteDocument(scope, recoveryId, signal), "資料を削除しました。");
        }}
      />
      {notice && <p role="status">{notice}</p>}
      {snapshot && (
        <>
          <p>この会話の資料: {snapshot.documents.length}件。1キャラクター全体で15件まで。</p>
          <p className="document-help">
            字数は上限です。会話設定の残枠内で使用します。OFF・削除は次の返信から反映され、過去の会話は残ります。
          </p>
          <form
            className="document-budget"
            onSubmit={(event) => {
              event.preventDefault();
              void run(
                (signal) => setDocumentBudget(scope, parseDocumentBudget(totalBudget), signal),
                "資料全体の上限を保存しました。",
              );
            }}
          >
            <label>
              資料全体の字数上限
              <input
                type="number"
                min="0"
                max="100000"
                step="1"
                inputMode="numeric"
                value={totalBudget}
                disabled={busy}
                onChange={(event) => setTotalBudget(event.currentTarget.value)}
              />
            </label>
            <button type="submit" disabled={busy}>
              上限を保存
            </button>
          </form>
          <form
            className="document-upload"
            onSubmit={(event) => {
              event.preventDefault();
              if (!file) {
                setError("TXTファイルを選んでください");
                return;
              }
              void run(
                (signal) => uploadDocument(scope, file, signal),
                "資料を取り込みました。",
                () => {
                  setFile(null);
                  setFileKey((value) => value + 1);
                },
              );
            }}
          >
            <label>
              TXTファイル（UTF-8、2 MiBまで）
              <input
                key={fileKey}
                type="file"
                accept=".txt,text/plain"
                disabled={busy}
                onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)}
              />
            </label>
            <button type="submit" disabled={busy || !file}>
              {busy ? "操作中…" : "資料を取り込む"}
            </button>
          </form>
          <p className="document-help">TXTの本文は20万字まで読み込めます。</p>
          {snapshot.documents.length === 0 ? (
            <p>この会話に登録した資料はありません。</p>
          ) : (
            <ul className="document-list">
              {snapshot.documents.map((document) => (
                <DocumentRow
                  key={document.id}
                  document={document}
                  busy={busy}
                  onToggle={(id, enabled) => {
                    void run(
                      (signal) => updateDocument(scope, id, { enabled }, signal),
                      enabled ? "資料の参照をONにしました。" : "資料の参照をOFFにしました。",
                    );
                  }}
                  onBudget={(id, value) => {
                    void run(
                      (signal) =>
                        updateDocument(
                          scope,
                          id,
                          { budgetChars: parseDocumentBudget(value) },
                          signal,
                        ),
                      "資料の字数上限を保存しました。",
                    );
                  }}
                  onRemove={(id) => {
                    void run((signal) => deleteDocument(scope, id, signal), "資料を削除しました。");
                  }}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
};

export const DocumentPanel = ({ characterId, conversationId }: DocumentPanelProps) => (
  <section className="document-panel" aria-label="資料の管理">
    <h3>資料</h3>
    {conversationId === null ? (
      <p>最初の会話後に資料を管理できます。</p>
    ) : (
      <ScopedDocumentPanel
        key={`${characterId}:${conversationId}`}
        characterId={characterId}
        conversationId={conversationId}
      />
    )}
  </section>
);
