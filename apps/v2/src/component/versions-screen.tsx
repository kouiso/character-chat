// 版の履歴（板 Versions「前の設定 見て戻す」）。キャラの編集の「前の設定」から入る画面。
// 版を選ぶとその時点の中身を読み、現行でなければ「この設定に戻す」で戻せる。
// 戻すのは新しい版を積むのではなく「いま」の指し先をその版へ戻す
// （restoreCharacterVersion が currentVersionId を差し替えるだけ。会話は始めた時の版のまま動く）。
import { useEffect, useRef, useState } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { z } from "zod";

import { storedCharacterContentSchema, type CharacterContent } from "@v2/db/character-version";
import { characterDraftKey } from "../lib/character-draft";
import { characterPath, CharacterRequestError, requestCharacter } from "../lib/character-editor";

import "./versions-screen.css";

export type VersionsCharacter = {
  id: string;
  name: string;
  revision: number;
  ownerUserId: string;
};

export type VersionsRow = { id: string; version: number; createdAt: number };

type VersionDetail = { id: string; version: number; createdAt: number; content: CharacterContent };

const versionDetailSchema = z.object({
  id: z.string(),
  version: z.number().int(),
  createdAt: z.number(),
  content: storedCharacterContentSchema,
});

const restoredSchema = z.object({ id: z.string(), revision: z.number(), versionId: z.string() });

// 「たくさんある時」は 5 行まで出して「もっと前を見る」で全展開（板の行数）。
const COLLAPSED_ROWS = 5;

const formatStamp = (time: number): string => {
  const d = new Date(time);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
};

// 板では一覧行だけ時分つきで、見出し・確かめ文・顔の代替は日付だけ。
const formatDay = (time: number): string => {
  const d = new Date(time);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};

const memoryKindsLabel = (kinds: CharacterContent["memoryKinds"]): string =>
  kinds.length === 0 ? "" : kinds.map((kind) => (kind === "fact" ? "事実" : "好み")).join("、");

const BackIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M15 5l-7 7 7 7" />
  </svg>
);

const CheckIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

const AlertIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5v5.5" />
    <path d="M12 16v.5" />
  </svg>
);

const Header = ({ characterId }: { characterId: string }) => (
  <header className="v2-versions-header">
    <Link
      to="/characters/$id"
      params={{ id: characterId }}
      aria-label="戻る"
      className="v2-versions-icon-button"
    >
      <BackIcon />
    </Link>
    <h1 className="v2-versions-title">前の設定</h1>
  </header>
);

const Note = () => (
  <p className="v2-versions-note">
    保存するたびに残ります。
    <br />
    始めた会話は、その時の設定のまま続きます。
  </p>
);

// 失敗の全面形（板: alert カード＋下の帯のボタン）。
const FailurePage = ({
  characterId,
  title,
  sub,
  action,
}: {
  characterId: string;
  title: string;
  sub?: string;
  action: { label: string; to?: string; onClick?: () => void };
}) => (
  <div className="v2-versions-page">
    <Header characterId={characterId} />
    <div className="v2-versions-body">
      <div role="alert" className="v2-versions-alert">
        <span className="v2-versions-alert-icon">
          <AlertIcon />
        </span>
        <span className="v2-versions-alert-text">
          <span>{title}</span>
          {sub && <span className="v2-versions-alert-sub">{sub}</span>}
        </span>
      </div>
    </div>
    <div className="v2-versions-bar">
      {action.to ? (
        <Link to={action.to} params={{ id: characterId }} className="v2-versions-primary">
          <span>{action.label}</span>
        </Link>
      ) : (
        <button type="button" className="v2-versions-primary" onClick={action.onClick}>
          <span>{action.label}</span>
        </button>
      )}
    </div>
  </div>
);

export const VersionsLoadingState = ({ characterId }: { characterId: string }) => (
  <div className="v2-versions-page">
    <Header characterId={characterId} />
    <div className="v2-versions-body" aria-busy="true">
      <Note />
      <output aria-label="読み込んでいます">
        <div className="v2-versions-skeleton-card" aria-hidden="true" />
        <div className="v2-versions-skeleton-detail" aria-hidden="true">
          {[0, 1, 2, 3].map((line) => (
            <span key={line} className="v2-versions-skeleton-line" />
          ))}
        </div>
      </output>
    </div>
  </div>
);

export const VersionsErrorState = ({
  characterId,
  onRetry,
}: {
  characterId: string;
  onRetry: () => void;
}) => (
  <FailurePage
    characterId={characterId}
    title="前の設定を読み込めませんでした。"
    action={{ label: "もう一度", onClick: onRetry }}
  />
);

export const VersionsNotFoundState = ({ characterId }: { characterId: string }) => (
  <FailurePage
    characterId={characterId}
    title="この設定が見つかりませんでした。"
    action={{ label: "編集に戻る", to: "/characters/$id" }}
  />
);

const Field = ({ label, children }: { label: string; children?: string | null }) => (
  <div className="v2-versions-field">
    <div className="v2-versions-field-label">{label}</div>
    <div className={children ? "v2-versions-field-value" : "v2-versions-field-empty"}>
      {children ? children : "入っていません"}
    </div>
  </div>
);

const VersionDetailView = ({
  characterId,
  detail,
}: {
  characterId: string;
  detail: VersionDetail;
}) => {
  const { content } = detail;
  return (
    <section className="v2-versions-detail" aria-label={`${formatDay(detail.createdAt)}の設定`}>
      <h2 className="v2-versions-detail-title">{formatDay(detail.createdAt)}の設定</h2>
      <div className="v2-versions-fields">
        <div className="v2-versions-field">
          <div className="v2-versions-field-label">顔</div>
          <div className="v2-versions-face">
            {content.avatarRef ? (
              <img
                src={`/api/characters/${encodeURIComponent(characterId)}/versions/${encodeURIComponent(detail.id)}/avatar`}
                alt={`${formatDay(detail.createdAt)}の顔`}
                onError={(event) => {
                  // 絵が消えた版は「入っていません」と同じ扱いに倒す。
                  event.currentTarget.replaceWith(document.createTextNode("入っていません"));
                }}
              />
            ) : (
              <span className="v2-versions-field-empty">入っていません</span>
            )}
          </div>
        </div>
        <Field label="名前">{content.name}</Field>
        <Field label="ひとこと">{content.bio}</Field>
        {/* 紹介・始まり方・絵の見た目は板にだけある欄で、いまの設定スキーマには無い。
            欄だけ板どおりに残し「入っていません」と出す。 */}
        <Field label="紹介">{null}</Field>
        <Field label="性格">{content.personality}</Field>
        <Field label="話し方">{content.speechStyle}</Field>
        <Field label="はじまりのひとこと">{content.greeting}</Field>
        <Field label="始まり方">{null}</Field>
        <Field label="プロローグ">{content.prologue}</Field>
        <Field label="外見">{content.appearance}</Field>
        <Field label="絵の見た目">{null}</Field>
        <Field label="背景">{content.background}</Field>
        <Field label="世界設定">{content.worldSetting}</Field>
        <Field label="秘めた面">{content.privateNotes}</Field>
        <Field label="何を覚えるか">{content.memoryInstruction}</Field>
        <Field label="覚える種類">{memoryKindsLabel(content.memoryKinds)}</Field>
        <div className="v2-versions-field">
          <div className="v2-versions-field-label">タグ</div>
          {content.tags.length > 0 ? (
            <div className="v2-versions-tags">
              {content.tags.map((tag) => (
                <span key={tag}>
                  <b>#</b> {tag}
                </span>
              ))}
            </div>
          ) : (
            <div className="v2-versions-field-empty">入っていません</div>
          )}
        </div>
        {content.legacyReconstructed && (
          <p className="v2-versions-legacy-note">
            旧設定から再構成した版です。当時の履歴を完全に復元したものではありません。
          </p>
        )}
      </div>
    </section>
  );
};

const VersionRowList = ({
  versions,
  currentVersionId,
  selectedId,
  expanded,
  onSelect,
  onExpand,
}: {
  versions: VersionsRow[];
  currentVersionId: string | null;
  selectedId: string | null;
  expanded: boolean;
  onSelect: (id: string) => void;
  onExpand: () => void;
}) => {
  const shown = expanded ? versions : versions.slice(0, COLLAPSED_ROWS);
  return (
    <>
      <div role="group" aria-label="前の設定">
        <div className="v2-versions-list">
          {shown.map((row) => {
            const stamp = formatStamp(row.createdAt);
            return (
              <button
                key={row.id}
                type="button"
                aria-pressed={row.id === selectedId}
                aria-label={`${stamp}の設定を見る`}
                className={`v2-versions-row${row.id === selectedId ? " is-selected" : ""}`}
                onClick={() => onSelect(row.id)}
              >
                <span className="v2-versions-row-stamp">{stamp}</span>
                {row.id === currentVersionId && <span className="v2-versions-row-now">いま</span>}
                <span className="v2-versions-row-flex" />
                {row.id === selectedId && (
                  <span className="v2-versions-row-check">
                    <CheckIcon />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      {versions.length > COLLAPSED_ROWS && !expanded && (
        <button type="button" className="v2-versions-more" onClick={onExpand}>
          もっと前を見る
        </button>
      )}
    </>
  );
};

const FooterBar = ({
  hasOld,
  isCurrentPicked,
  ready,
  onRestore,
}: {
  hasOld: boolean;
  isCurrentPicked: boolean;
  ready: boolean;
  onRestore: () => void;
}) => (
  <div className="v2-versions-bar">
    {!hasOld ? (
      <div className="v2-versions-bar-note">前の設定は、まだありません。</div>
    ) : isCurrentPicked ? (
      <div className="v2-versions-bar-note">いまの設定です。戻す必要はありません。</div>
    ) : (
      <button type="button" className="v2-versions-primary" disabled={!ready} onClick={onRestore}>
        <span>この設定に戻す</span>
      </button>
    )}
  </div>
);

const DetailSkeleton = () => (
  <div className="v2-versions-detail">
    <output aria-label="読み込んでいます">
      <div aria-hidden="true" className="v2-versions-skeleton-detail">
        {[0, 1, 2, 3].map((line) => (
          <span key={line} className="v2-versions-skeleton-line" />
        ))}
      </div>
    </output>
  </div>
);

const RestoredToast = ({ characterId }: { characterId: string }) => (
  <output className="v2-versions-toast">
    <span className="v2-versions-toast-text">前の設定に戻しました</span>
    <Link
      to="/chat/$id"
      params={{ id: characterId }}
      search={{ newChat: crypto.randomUUID() }}
      className="v2-versions-toast-action"
    >
      新しい会話を始める
    </Link>
  </output>
);

const RestoreSheet = ({
  detail,
  restoring,
  onCancel,
  onConfirm,
}: {
  detail: VersionDetail;
  restoring: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) => (
  <div className="v2-versions-scrim">
    <div
      role="alertdialog"
      aria-labelledby="v2-versions-confirm-title"
      className="v2-versions-sheet"
    >
      <div aria-hidden="true" className="v2-versions-sheet-grabber" />
      <h2 id="v2-versions-confirm-title" className="v2-versions-sheet-title">
        {formatDay(detail.createdAt)}の設定に戻しますか？
      </h2>
      <div className="v2-versions-sheet-text">
        保存していない変更は消えます。
        <br />
        これまでの会話はそのままです。
      </div>
      <div className="v2-versions-sheet-actions">
        <button
          type="button"
          className="v2-versions-sheet-cancel"
          disabled={restoring}
          onClick={onCancel}
        >
          やめる
        </button>
        <button
          type="button"
          className="v2-versions-primary"
          disabled={restoring}
          onClick={onConfirm}
        >
          <span>{restoring ? "戻しています" : "戻す"}</span>
        </button>
      </div>
    </div>
  </div>
);

// 選んだ版の中身を版ごとの口から読む。現行・未選択・読み済み・失敗済みは読まない。
const useVersionDetail = (
  characterId: string,
  selectedId: string | null,
  currentVersionId: string | null,
) => {
  const [details, setDetails] = useState<Record<string, VersionDetail>>({});
  const [detailErrors, setDetailErrors] = useState<Record<string, "error" | "notfound">>({});
  const requestRef = useRef(0);

  useEffect(() => {
    if (
      !selectedId ||
      selectedId === currentVersionId ||
      details[selectedId] ||
      detailErrors[selectedId]
    ) {
      return;
    }
    const requestId = ++requestRef.current;
    void requestCharacter(
      `${characterPath(characterId)}/versions/${encodeURIComponent(selectedId)}`,
      versionDetailSchema,
    )
      .then((result) => {
        if (requestRef.current !== requestId) return;
        setDetails((prev) => ({ ...prev, [selectedId]: result }));
      })
      .catch((cause) => {
        if (requestRef.current !== requestId) return;
        setDetailErrors((prev) => ({
          ...prev,
          [selectedId]:
            cause instanceof CharacterRequestError && cause.status === 404 ? "notfound" : "error",
        }));
      });
  }, [selectedId, currentVersionId, characterId, details, detailErrors]);

  const retry = () => {
    if (!selectedId) return;
    // 失敗印を外すと読みの効果がもう一度走る。
    setDetailErrors((prev) => {
      const next = { ...prev };
      delete next[selectedId];
      return next;
    });
  };

  return {
    detail: selectedId ? details[selectedId] : undefined,
    detailFailure: selectedId ? detailErrors[selectedId] : undefined,
    retry,
  };
};

// 「この設定に戻す」の実行。expectedRevision で別画面の変更とぶつかったら失敗側に倒す。
const useRestore = (
  character: VersionsCharacter,
  detail: VersionDetail | undefined,
  onRestored: (versionId: string) => void,
) => {
  const router = useRouter();
  const [restoring, setRestoring] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const [restored, setRestored] = useState(false);

  const restore = async () => {
    if (!detail || restoring) return;
    setRestoring(true);
    try {
      const saved = await requestCharacter(
        `${characterPath(character.id)}/restore`,
        restoredSchema,
        {
          method: "POST",
          body: JSON.stringify({ versionId: detail.id, expectedRevision: character.revision }),
        },
      );
      try {
        localStorage.removeItem(characterDraftKey(character.ownerUserId, character.id));
      } catch {
        /* 戻した版の確定は端末の下書き消去に依存せん。 */
      }
      // 失敗 → もう一度 → 成功、で失敗形が残らんよう成功側でも戻す。
      setRestoreFailed(false);
      setRestored(true);
      // 板「戻したあと」は選びが新しい現行（いま）に移る。
      onRestored(saved.versionId);
      await router.invalidate({
        filter: (match) => match.routeId === "/characters/$id_/versions",
      });
    } catch {
      setRestoreFailed(true);
    } finally {
      setRestoring(false);
    }
  };

  return { restore, restoring, restoreFailed, restored };
};

export const VersionsScreen = ({
  character,
  currentVersionId,
  versions,
}: {
  character: VersionsCharacter;
  currentVersionId: string | null;
  versions: VersionsRow[];
}) => {
  // いま（現行）を選んだ時は中身を出さん（板「いまの設定を選んでいる時」）。
  const firstOld = versions.find((row) => row.id !== currentVersionId) ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(firstOld?.id ?? null);
  const [expanded, setExpanded] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const {
    detail,
    detailFailure,
    retry: retryDetail,
  } = useVersionDetail(character.id, selectedId, currentVersionId);
  const { restore, restoring, restoreFailed, restored } = useRestore(
    character,
    detail,
    (versionId) => {
      setConfirmOpen(false);
      setSelectedId(versionId);
    },
  );
  const hasOld = firstOld !== null;

  if (restoreFailed) {
    return (
      <FailurePage
        characterId={character.id}
        title="前の設定に戻せませんでした。"
        sub="いまの設定は残っています。"
        action={{ label: "もう一度", onClick: () => void restore() }}
      />
    );
  }
  if (detailFailure === "notfound") {
    return <VersionsNotFoundState characterId={character.id} />;
  }
  if (detailFailure === "error") {
    return (
      <FailurePage
        characterId={character.id}
        title="この設定の中身を読み込めませんでした。"
        action={{ label: "もう一度", onClick: retryDetail }}
      />
    );
  }

  return (
    <VersionsBody
      character={character}
      currentVersionId={currentVersionId}
      versions={versions}
      selectedId={selectedId}
      expanded={expanded}
      hasOld={hasOld}
      detail={detail}
      restoring={restoring}
      restored={restored}
      confirmOpen={confirmOpen}
      onSelect={setSelectedId}
      onExpand={() => setExpanded(true)}
      onConfirmOpen={() => setConfirmOpen(true)}
      onConfirmClose={() => setConfirmOpen(false)}
      onConfirm={() => void restore()}
    />
  );
};

const VersionsBody = ({
  character,
  currentVersionId,
  versions,
  selectedId,
  expanded,
  hasOld,
  detail,
  restoring,
  restored,
  confirmOpen,
  onSelect,
  onExpand,
  onConfirmOpen,
  onConfirmClose,
  onConfirm,
}: {
  character: VersionsCharacter;
  currentVersionId: string | null;
  versions: VersionsRow[];
  selectedId: string | null;
  expanded: boolean;
  hasOld: boolean;
  detail: VersionDetail | undefined;
  restoring: boolean;
  restored: boolean;
  confirmOpen: boolean;
  onSelect: (id: string) => void;
  onExpand: () => void;
  onConfirmOpen: () => void;
  onConfirmClose: () => void;
  onConfirm: () => void;
}) => {
  const showDetail = hasOld && selectedId !== null && selectedId !== currentVersionId;
  return (
    <div className="v2-versions-page">
      <Header characterId={character.id} />
      <div className="v2-versions-body">
        <Note />
        <div aria-hidden="true" className="v2-versions-gap-12" />
        <VersionRowList
          versions={versions}
          currentVersionId={currentVersionId}
          selectedId={selectedId}
          expanded={expanded}
          onSelect={onSelect}
          onExpand={onExpand}
        />
        {showDetail && (
          <>
            <div aria-hidden="true" className="v2-versions-gap-24" />
            {detail ? (
              <VersionDetailView characterId={character.id} detail={detail} />
            ) : (
              <DetailSkeleton />
            )}
          </>
        )}
        <div aria-hidden="true" className="v2-versions-gap-24" />
      </div>

      <FooterBar
        hasOld={hasOld}
        isCurrentPicked={!selectedId || selectedId === currentVersionId}
        ready={Boolean(detail)}
        onRestore={onConfirmOpen}
      />

      {restored && <RestoredToast characterId={character.id} />}

      {confirmOpen && detail && (
        <RestoreSheet
          detail={detail}
          restoring={restoring}
          onCancel={onConfirmClose}
          onConfirm={onConfirm}
        />
      )}
    </div>
  );
};
