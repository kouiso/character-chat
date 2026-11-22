// マイ画面（板 My）。つくった子の一覧・並べ替え・行き先の束。
// 値は design-token.css の変数だけ。文言は板どおり。
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";

import { avatarUrl } from "../lib/avatar-url";
import { jstDateKey } from "../server/jst-date";
import type { CharacterListItem } from "../server/characters";

import "./my-screen.css";

type SortKey = "talked" | "created" | "name";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "talked", label: "最後に話した順" },
  { key: "created", label: "つくった順" },
  { key: "name", label: "名前順" },
];

const COLLAPSED_ROWS = 5;

const WEEKDAYS = ["日曜", "月曜", "火曜", "水曜", "木曜", "金曜", "土曜"] as const;

// 板 My: 行の右の日付。きょう/きのう、7 日以内は曜日、それより前は M月D日。
export const myDateLabel = (talkedAt: number | null, now = Date.now()): string => {
  if (talkedAt === null) return "まだ話していない";
  const key = jstDateKey(talkedAt);
  if (key === jstDateKey(now)) return "きょう";
  const [year, month, day] = key.split("-").map(Number);
  const diffDays = Math.round(
    (new Date(`${jstDateKey(now)}T00:00:00+09:00`).getTime() -
      new Date(`${key}T00:00:00+09:00`).getTime()) /
      86_400_000,
  );
  if (diffDays === 1) return "きのう";
  if (diffDays <= 6) return WEEKDAYS[new Date(year, month - 1, day).getDay()];
  return `${month}月${day}日`;
};

const ChevronRight = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M9 5l7 7-7 7" />
  </svg>
);

const ChevronDown = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M5 9l7 7 7-7" />
  </svg>
);

const PlusIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </svg>
);

const CloseIcon = () => (
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
    <path d="M6 6l12 12" />
    <path d="M18 6L6 18" />
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

export type MyCharacter = CharacterListItem & { lastTalkedAt: number | null };

// 会話の updatedAt からキャラごとの「最後に話した」時刻を畳む
export const lastTalkedMap = (
  conversations: readonly { characterId: string; updatedAt: number }[],
): Map<string, number> => {
  const map = new Map<string, number>();
  for (const conversation of conversations) {
    const previous = map.get(conversation.characterId) ?? 0;
    if (conversation.updatedAt > previous)
      map.set(conversation.characterId, conversation.updatedAt);
  }
  return map;
};

const CharRow = ({ character, index }: { character: MyCharacter; index: number }) => (
  <div className="v2-my-char-row">
    <Link
      to="/characters/$id"
      params={{ id: character.id }}
      aria-label={`${character.name}のプロフィール`}
      className="v2-my-char-link"
    >
      <span className={`v2-my-char-face plate-${(index % 4) + 1}`} aria-hidden="true">
        {!character.avatar && character.name.slice(0, 1)}
        {character.avatar && (
          <img
            src={avatarUrl(character.id, character.avatar) ?? undefined}
            alt=""
            loading="lazy"
            onError={(event) => event.currentTarget.remove()}
          />
        )}
      </span>
      <span className="v2-my-char-text">
        <span className="v2-my-char-line">
          <span className="v2-my-char-name">{character.name}</span>
          <span className="v2-my-char-date">{myDateLabel(character.lastTalkedAt)}</span>
        </span>
        {character.tags.length > 0 && <span className="v2-my-char-tag">{character.tags[0]}</span>}
      </span>
    </Link>
    {character.canEdit && (
      <Link
        to="/characters/$id"
        params={{ id: character.id }}
        aria-label={`${character.name}を編集`}
        className="v2-my-char-edit"
      >
        編集
      </Link>
    )}
  </div>
);

const NavRow = ({
  label,
  value,
  to,
}: {
  label: string;
  value?: string;
  to?: "/" | "/catalog" | "/settings" | "/notifications";
}) => {
  // まだ行き先の画面が無い項目は、見た目だけ揃えて押せないまま置く
  const inner = (
    <>
      <span className="v2-my-nav-label">{label}</span>
      {value && <span className="v2-my-nav-value">{value}</span>}
      <span className="v2-my-nav-chevron">
        <ChevronRight />
      </span>
    </>
  );
  if (!to) {
    return (
      <span className="v2-my-nav-row" role="link" aria-disabled="true">
        {inner}
      </span>
    );
  }
  return (
    <Link to={to} className="v2-my-nav-row">
      {inner}
    </Link>
  );
};

const SortSheet = ({
  sort,
  onPick,
  onClose,
}: {
  sort: SortKey;
  onPick: (key: SortKey) => void;
  onClose: () => void;
}) => (
  <div className="v2-my-sheet-overlay" onClick={onClose}>
    <div
      className="v2-my-sheet"
      role="dialog"
      aria-label="並べ替え"
      onClick={(event) => event.stopPropagation()}
    >
      <span className="v2-my-sheet-grabber" />
      <div className="v2-my-sheet-head">
        <h2>並べ替え</h2>
        <button
          type="button"
          className="v2-my-icon-button"
          aria-label="並べ替えを閉じる"
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </div>
      <div className="v2-my-card" role="radiogroup" aria-label="つくった子の並べ方">
        {SORT_OPTIONS.map((option) => (
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={sort === option.key}
            className="v2-my-sort-choice"
            onClick={() => {
              onPick(option.key);
              onClose();
            }}
          >
            <span className="v2-my-sort-label">{option.label}</span>
            {sort === option.key && (
              <span className="v2-my-sort-check">
                <CheckIcon />
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  </div>
);

export const MyScreen = ({ characters }: { characters: MyCharacter[] }) => {
  const [sort, setSort] = useState<SortKey>("talked");
  const [expanded, setExpanded] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  const sorted = useMemo(() => {
    const rows = [...characters];
    if (sort === "name") {
      rows.sort((a, b) => a.name.localeCompare(b.name, "ja"));
    } else if (sort === "talked") {
      rows.sort((a, b) => (b.lastTalkedAt ?? 0) - (a.lastTalkedAt ?? 0));
    }
    return rows;
  }, [characters, sort]);

  const shown = expanded ? sorted : sorted.slice(0, COLLAPSED_ROWS);
  const sortLabel = SORT_OPTIONS.find((option) => option.key === sort)?.label ?? "";

  return (
    <div className="v2-my-page">
      <header className="v2-my-header">
        <h1>マイ</h1>
      </header>
      <div className="v2-my-body">
        <div className="v2-my-section-head">
          <h2>つくった子</h2>
          {characters.length > 0 && (
            <button
              type="button"
              className="v2-my-sort-button"
              aria-label={`並べ替え いまは${sortLabel}`}
              aria-haspopup="dialog"
              onClick={() => setSortOpen(true)}
            >
              <span>{sortLabel}</span>
              <span className="v2-my-icon-sub">
                <ChevronDown />
              </span>
            </button>
          )}
        </div>

        {characters.length === 0 ? (
          <div className="v2-my-empty">
            <p className="v2-my-empty-title">まだ、つくった子はいません</p>
            <p className="v2-my-empty-copy">ひとこと書くだけで、つくれます。</p>
          </div>
        ) : (
          <>
            {shown.map((character, index) => (
              <CharRow key={character.id} character={character} index={index} />
            ))}
            {sorted.length > shown.length && (
              <button type="button" className="v2-my-ghost" onClick={() => setExpanded(true)}>
                ほか {sorted.length - shown.length} 人を見る
              </button>
            )}
            {expanded && sorted.length > COLLAPSED_ROWS && (
              <button type="button" className="v2-my-ghost" onClick={() => setExpanded(false)}>
                たたむ
              </button>
            )}
          </>
        )}

        <Link to="/characters/new" className="v2-my-ghost">
          <span className="v2-my-icon-sub">
            <PlusIcon />
          </span>
          <span>新しい子をつくる</span>
          <span className="v2-my-icon-sub">
            <ChevronRight />
          </span>
        </Link>

        <div className="v2-my-spacer" aria-hidden="true" />

        <nav className="v2-my-nav" aria-label="マイの行き先">
          <div className="v2-my-card">
            <NavRow label="とっておいた子" to="/catalog" />
            <NavRow label="履歴" to="/" />
          </div>
          <div className="v2-my-card">
            <NavRow label="AI がおぼえた好み" />
            <NavRow label="設定" to="/settings" />
            <NavRow label="通知の設定" to="/notifications" />
          </div>
        </nav>
      </div>

      {sortOpen && <SortSheet sort={sort} onPick={setSort} onClose={() => setSortOpen(false)} />}
    </div>
  );
};

// 読み込み中・失敗の枠（板 My の状態。ルートの pending/error から使う）
export const MyLoadingState = () => (
  <div className="v2-my-page">
    <header className="v2-my-header">
      <h1>マイ</h1>
    </header>
    <div className="v2-my-body" aria-busy="true">
      <div className="v2-my-section-head">
        <h2>つくった子</h2>
      </div>
      <span className="v2-sr-only">読み込んでいます</span>
      <div className="v2-my-skeleton" aria-hidden="true">
        {[0, 1, 2].map((line) => (
          <span key={line} className="v2-my-skeleton-line" />
        ))}
      </div>
    </div>
  </div>
);

export const MyErrorState = ({ onRetry }: { onRetry: () => void }) => (
  <div className="v2-my-page">
    <header className="v2-my-header">
      <h1>マイ</h1>
    </header>
    <div className="v2-my-body">
      <div className="v2-my-section-head">
        <h2>つくった子</h2>
      </div>
      <div className="v2-my-error">
        <span className="v2-my-error-text">つくった子を読み込めませんでした。</span>
        <button type="button" className="v2-my-secondary" onClick={onRetry}>
          もう一度
        </button>
      </div>
    </div>
  </div>
);
