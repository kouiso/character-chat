// 出会う（板 Meet・MeetList・MeetEmpty）。デッキ（1人ずつ・左右に送る）と
// 一覧（札・見たい子・名前さがしの 2 列）。会える子は local・移行元名義・公式。
import { useEffect, useMemo, useRef, useState } from "react";

import { Link, useNavigate, useRouter } from "@tanstack/react-router";

import { avatarUrl } from "../lib/avatar-url";
import { useChatOnline } from "../lib/chat-online";
import { setCharacterKept } from "../lib/meet";

import "./make-screen.css";
import "./meet-screen.css";

import type { MeetCharacter } from "../server/api-meet";

type MeetMode = "deck" | "list";
type WantFilter = "all" | "official" | "own" | "talked" | "kept";

type Toast =
  | { kind: "kept" }
  | { kind: "skipped" }
  | { kind: "keep-failed" | "offline"; retryId: string };

// 板の札 2 段（状況・関係／相手の態度。MeetList）
const RELATION_CHIPS = ["同棲", "職場", "禁断", "再会", "初対面"] as const;
const ATTITUDE_CHIPS = ["甘々", "強気", "受け身", "ツンデレ", "そっけない"] as const;

const WANT_LABELS: Record<WantFilter, string> = {
  all: "すべての子",
  official: "公式の子",
  own: "つくった子",
  talked: "話したことがある子",
  kept: "とっておいた子",
};

// 「左右に送れます」は初めての時だけ出る 1 行（板 Meet）
const HINT_KEY = "v2-meet-swipe-hint";

const FLY_MS = 240;
const TOAST_MS = 6000;
const FLICK_PX = 80;

const Icon = ({
  size = 18,
  width = 1.75,
  children,
}: {
  size?: number;
  width?: number;
  children: React.ReactNode;
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={width}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

const CardIcon = () => (
  <Icon size={20}>
    <rect x="7" y="4" width="10" height="16" rx="2.5" />
    <path d="M3.5 8v8" />
    <path d="M20.5 8v8" />
  </Icon>
);

const ListIcon = () => (
  <Icon size={20}>
    <path d="M9 7h11" />
    <path d="M9 12h11" />
    <path d="M9 17h11" />
    <path d="M4.5 7h.5" />
    <path d="M4.5 12h.5" />
    <path d="M4.5 17h.5" />
  </Icon>
);

const XIcon = () => (
  <Icon>
    <path d="M6 6l12 12" />
    <path d="M18 6L6 18" />
  </Icon>
);

const KeepIcon = () => (
  <Icon>
    <path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z" />
  </Icon>
);

const ArrowRightIcon = () => (
  <Icon size={20} width={2}>
    <path d="M5 12h14" />
    <path d="M13 6l6 6-6 6" />
  </Icon>
);

const ChevronDownIcon = () => (
  <Icon>
    <path d="M5 9l7 7 7-7" />
  </Icon>
);

const ChevronRightIcon = () => (
  <Icon>
    <path d="M9 5l7 7-7 7" />
  </Icon>
);

const SearchIcon = () => (
  <Icon size={20}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4.5 4.5" />
  </Icon>
);

const CheckIcon = () => (
  <Icon size={20} width={2}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Icon>
);

// 頭文字の札は 4 色を行ごとに回す（KIT §1.1）。同じ子はいつも同じ色。
const plateTone = (id: string) => {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return (hash % 4) + 1;
};

// セリフは板どおり「」で包む（home の quoteLine と同じ決まり）
const quoteLine = (text: string) => (text.startsWith("「") ? text : `「${text}」`);

const MeetPlate = () => (
  <div className="v2-meet-plate">
    <span className="v2-meet-plate-title">出会う</span>
    <span className="v2-meet-plate-sub">今夜ひま？</span>
  </div>
);

const MeetHead = ({ mode, onMode }: { mode: MeetMode; onMode: (mode: MeetMode) => void }) => (
  <>
    <MeetPlate />
    <div role="group" aria-label="見え方" className="v2-meet-toggle">
      <button
        type="button"
        aria-label="1 人ずつ見る"
        aria-pressed={mode === "deck"}
        onClick={() => onMode("deck")}
      >
        <CardIcon />
      </button>
      <button
        type="button"
        aria-label="一覧で見る"
        aria-pressed={mode === "list"}
        onClick={() => onMode("list")}
      >
        <ListIcon />
      </button>
    </div>
  </>
);

const MeetSkeleton = () => (
  <div className="v2-meet-deck" role="status" aria-label="読み込んでいます">
    <div className="v2-meet-stage">
      <div className="v2-meet-card">
        <div className="v2-meet-skeleton-hero" />
        <div className="v2-meet-skeleton-lines">
          <span className="hi" />
          <span className="lo" />
          <span className="lo" />
        </div>
      </div>
    </div>
  </div>
);

export const MeetLoadingState = () => (
  <div className="v2-meet">
    <MeetPlate />
    <MeetSkeleton />
  </div>
);

export const MeetErrorState = () => {
  const router = useRouter();
  const online = useChatOnline();
  return (
    <div className="v2-meet">
      <MeetPlate />
      <div className="v2-meet-state" role="alert">
        <div className="v2-meet-state-title">
          {online ? "出会う子を読み込めませんでした" : "オフラインです"}
        </div>
        <button
          type="button"
          className="v2-meet-quiet-button primary"
          onClick={() => void router.invalidate()}
        >
          もう一度
        </button>
      </div>
    </div>
  );
};

// ---- デッキ（1 人ずつ） ----

const MeetCardHero = ({ item }: { item: MeetCharacter }) => (
  <div className="v2-meet-hero">
    {item.avatar ? (
      <img src={avatarUrl(item.id, item.avatar) ?? undefined} alt={item.name} draggable={false} />
    ) : (
      <span aria-hidden="true" className={`v2-meet-hero-plate plate-${plateTone(item.id)}`}>
        {item.name.slice(0, 1)}
      </span>
    )}
    <div className="v2-meet-hero-edge" aria-hidden="true" />
  </div>
);

const MeetCardText = ({ item, interactive }: { item: MeetCharacter; interactive: boolean }) => {
  const tags = item.tags.slice(1, 4);
  const role = item.tags[0] ? `${item.tags[0]}${item.official ? " ・ 公式" : ""}` : "";
  return (
    <>
      <div className="v2-meet-namerow">
        <h1>{item.name}</h1>
        <span className="v2-meet-awake">起きてる</span>
        {item.own && <span className="v2-meet-kind">つくった子</span>}
        <Link
          to="/characters/$id"
          params={{ id: item.id }}
          aria-label={interactive ? `${item.name}のプロフィール` : undefined}
          tabIndex={interactive ? 0 : -1}
          className="v2-meet-profile-link"
        >
          <span>プロフィール</span>
          <ChevronRightIcon />
        </Link>
      </div>
      {role && <div className="v2-meet-role">{role}</div>}
      <div className="v2-meet-spacer-16" aria-hidden="true" />
      {item.greeting && <div className="v2-meet-bubble">{quoteLine(item.greeting)}</div>}
      {tags.length > 0 && (
        <>
          <div className="v2-meet-spacer-12" aria-hidden="true" />
          <div className="v2-meet-tags">
            {tags.map((tag) => (
              <span key={tag}>
                <b>#</b> {tag}
              </span>
            ))}
          </div>
        </>
      )}
    </>
  );
};

// 「話す」は毎回あたらしい会話の鍵を付けて開く（characters/$id と同じ約束）。
// 鍵をレンダー時に作ると SSR とクライアントで値がずれるので、押した時に作る。
const MeetTalkLink = ({ item }: { item: MeetCharacter }) => {
  const navigate = useNavigate();
  return (
    <a
      href={`/chat/${item.id}`}
      aria-label={`${item.name}と話す`}
      className="v2-meet-talk"
      onClick={(event) => {
        event.preventDefault();
        void navigate({
          to: "/chat/$id",
          params: { id: item.id },
          search: { newChat: crypto.randomUUID() },
        });
      }}
    >
      <span>話す</span>
      <ArrowRightIcon />
    </a>
  );
};

const MeetCardActions = ({
  item,
  interactive,
  keepBusy,
  onKeep,
  onSkip,
}: {
  item: MeetCharacter;
  interactive: boolean;
  keepBusy: boolean;
  onKeep?: () => void;
  onSkip?: () => void;
}) => (
  <div className="v2-meet-actions" aria-hidden={!interactive || undefined}>
    <button
      type="button"
      aria-label={interactive ? `${item.name}を飛ばす` : undefined}
      className="v2-meet-skip"
      disabled={!interactive}
      tabIndex={interactive ? 0 : -1}
      onClick={onSkip}
    >
      <XIcon />
      <span>飛ばす</span>
    </button>
    <button
      type="button"
      aria-label={interactive ? `${item.name}をとっておく` : undefined}
      className="v2-meet-keep"
      disabled={!interactive || keepBusy}
      tabIndex={interactive ? 0 : -1}
      onClick={onKeep}
    >
      <KeepIcon />
      <span>とっておく</span>
    </button>
    {interactive ? (
      <MeetTalkLink item={item} />
    ) : (
      <span className="v2-meet-talk">
        <span>話す</span>
        <ArrowRightIcon />
      </span>
    )}
  </div>
);

const MeetCard = ({
  item,
  dragX,
  className,
  stamp,
  onKeep,
  onSkip,
  keepBusy,
}: {
  item: MeetCharacter;
  dragX?: number;
  className?: string;
  stamp?: "keep" | "skip";
  onKeep?: () => void;
  onSkip?: () => void;
  keepBusy?: boolean;
}) => {
  const interactive = onKeep !== undefined;
  const style: React.CSSProperties = {};
  if (dragX !== undefined && dragX !== 0) {
    style.transform = `translateX(${dragX}px) rotate(${dragX / 24}deg)`;
  }
  return (
    <div className={`v2-meet-card${className ? ` ${className}` : ""}`} style={style}>
      {/* 引いている向きの印（板 Meet の drag 状態。カードと一緒に傾く） */}
      {stamp && (
        <div aria-hidden="true" className={`v2-meet-stamp ${stamp}`}>
          {stamp === "keep" ? "とっておく" : "飛ばす"}
        </div>
      )}
      <MeetCardHero item={item} />
      <div className="v2-meet-body">
        <MeetCardText item={item} interactive={interactive} />
        <MeetCardActions
          item={item}
          interactive={interactive}
          keepBusy={keepBusy ?? false}
          onKeep={onKeep}
          onSkip={onSkip}
        />
      </div>
    </div>
  );
};

const MeetToast = ({
  toast,
  onViewKept,
  onUndo,
  onRetry,
}: {
  toast: Toast;
  onViewKept: () => void;
  onUndo: () => void;
  onRetry: (id: string) => void;
}) => {
  const text =
    toast.kind === "kept"
      ? "とっておきました"
      : toast.kind === "skipped"
        ? "飛ばしました"
        : toast.kind === "keep-failed"
          ? "この子をとっておけませんでした"
          : "オフラインです";
  return (
    <div role="status" className="v2-meet-toast">
      <span className="v2-meet-toast-text">{text}</span>
      {toast.kind === "kept" && (
        <button type="button" className="v2-meet-toast-action" onClick={onViewKept}>
          とっておいた子を見る
        </button>
      )}
      {toast.kind === "skipped" && (
        <button type="button" className="v2-meet-toast-action" onClick={onUndo}>
          元に戻す
        </button>
      )}
      {(toast.kind === "keep-failed" || toast.kind === "offline") && (
        <button
          type="button"
          className="v2-meet-toast-action"
          onClick={() => onRetry(toast.retryId)}
        >
          もう一度
        </button>
      )}
    </div>
  );
};

const MeetDeckEmpty = ({ onReset }: { onReset: () => void }) => (
  <div className="v2-meet-deck">
    <div className="v2-meet-state">
      <div className="v2-meet-state-title">ひととおり会いました</div>
      <div className="v2-meet-state-text">はじめから見るか、自分でつくれます。</div>
      <div className="v2-meet-state-actions">
        <button type="button" className="v2-meet-quiet-button" onClick={onReset}>
          はじめから見る
        </button>
        <Link to="/characters/new" className="v2-meet-quiet-button primary">
          自分でつくる
        </Link>
      </div>
    </div>
  </div>
);

const readHintSeen = () => {
  try {
    return localStorage.getItem(HINT_KEY) === "1";
  } catch {
    return true;
  }
};

// 「とっておく」の保存処理。API が通ってから印を付ける
// （失敗したらカードは残り、知らせからもう一度出せる）
const useMeetKeep = ({
  onKept,
  setToast,
}: {
  onKept: (id: string) => void;
  setToast: (toast: Toast | null) => void;
}) => {
  const online = useChatOnline();
  const [keepBusy, setKeepBusy] = useState(false);

  const doKeep = (id: string) => {
    if (keepBusy) return;
    setKeepBusy(true);
    void setCharacterKept(id)
      .then(() => {
        onKept(id);
        setToast({ kind: "kept" });
      })
      .catch(() => {
        setToast(online ? { kind: "keep-failed", retryId: id } : { kind: "offline", retryId: id });
      })
      .finally(() => setKeepBusy(false));
  };

  return { keepBusy, doKeep };
};

// カードの引きずり。押した場所からのずれを追って、閾値を超えて離す（または
// 操作ボタン）と画面外へ飛ばしてから「送る」。リンク・ボタンの上では始めない。
const useMeetDrag = ({
  disabled,
  onFling,
}: {
  disabled: boolean;
  onFling: (action: "skip" | "keep") => void;
}) => {
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [flying, setFlying] = useState(false);
  const startX = useRef(0);
  const flyTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (flyTimer.current !== null) window.clearTimeout(flyTimer.current);
    },
    [],
  );

  const fling = (action: "skip" | "keep") => {
    if (disabled || flying) return;
    setDragX(action === "skip" ? -440 : 440);
    setFlying(true);
    flyTimer.current = window.setTimeout(() => {
      setFlying(false);
      setDragX(0);
      onFling(action);
    }, FLY_MS);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || flying) return;
    if ((event.target as HTMLElement).closest("a,button")) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    startX.current = event.clientX;
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragX(Math.max(-180, Math.min(180, event.clientX - startX.current)));
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    const dx = event.clientX - startX.current;
    if (dx <= -FLICK_PX) fling("skip");
    else if (dx >= FLICK_PX) fling("keep");
    else setDragX(0);
  };

  return {
    dragX,
    dragging,
    flying,
    fling,
    stageProps: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
  };
};

// 台（カード＋知らせ）を置く見た目。状態は MeetDeck が持つ
const MeetStage = ({
  current,
  next,
  showUnder,
  dragX,
  className,
  stamp,
  hintSeen,
  keepBusy,
  toast,
  stageProps,
  onSkip,
  onKeep,
  onViewKept,
  onUndo,
  onRetry,
}: {
  current: MeetCharacter;
  next?: MeetCharacter;
  showUnder: boolean;
  dragX: number;
  className: string;
  stamp?: "keep" | "skip";
  hintSeen: boolean;
  keepBusy: boolean;
  toast: Toast | null;
  stageProps: {
    onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
    onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
    onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
    onPointerCancel: (event: React.PointerEvent<HTMLDivElement>) => void;
  };
  onSkip: () => void;
  onKeep: () => void;
  onViewKept: () => void;
  onUndo: () => void;
  onRetry: (id: string) => void;
}) => (
  <>
    <div className="v2-meet-stage" {...stageProps}>
      {next && showUnder && <MeetCard item={next} className="under" />}
      <MeetCard
        item={current}
        dragX={dragX}
        className={className}
        stamp={stamp}
        onSkip={onSkip}
        onKeep={onKeep}
        keepBusy={keepBusy}
      />
      {!hintSeen && (
        <div role="note" className="v2-meet-hint">
          <ArrowRightIcon />
          <span>左右に送れます</span>
          <ArrowRightIcon />
        </div>
      )}
    </div>
    {/* 最後の1枚を送った時も「元に戻す」「とっておきました」を残す（板の知らせ） */}
    {toast && <MeetToast toast={toast} onViewKept={onViewKept} onUndo={onUndo} onRetry={onRetry} />}
  </>
);

const MeetDeck = ({
  items,
  keptIds,
  onKept,
  onShowKept,
  toast,
  setToast,
}: {
  items: MeetCharacter[];
  keptIds: Set<string>;
  onKept: (id: string) => void;
  onShowKept: () => void;
  toast: Toast | null;
  setToast: (toast: Toast | null) => void;
}) => {
  const [skipped, setSkipped] = useState<string[]>([]);
  const [settleKey, setSettleKey] = useState<string | null>(null);
  // 初回だけ出る 1 行は SSR とクライアントで見え方を揃えるため、
  // 最初は「見た」として描き、乗ってから実際の記憶を読む
  const [hintSeen, setHintSeen] = useState(true);
  useEffect(() => setHintSeen(readHintSeen()), []);
  const prevTopId = useRef<string | null>(null);
  const { keepBusy, doKeep } = useMeetKeep({ onKept, setToast });

  // デッキは「とっておいた子」と、セッション中に飛ばした子を抜いた残り
  const deck = useMemo(
    () => items.filter((item) => !keptIds.has(item.id) && !skipped.includes(item.id)),
    [items, keptIds, skipped],
  );
  const current = deck[0];
  const next = deck[1];

  const markHintSeen = () => {
    if (hintSeen) return;
    setHintSeen(true);
    try {
      localStorage.setItem(HINT_KEY, "1");
    } catch {
      // 書けなくても動作には影響しない
    }
  };

  const onFling = (action: "skip" | "keep") => {
    if (!current) return;
    markHintSeen();
    if (action === "keep") {
      doKeep(current.id);
    } else {
      setSkipped((prev) => [...prev, current.id]);
      setToast({ kind: "skipped" });
    }
  };

  const { dragX, dragging, flying, fling, stageProps } = useMeetDrag({
    disabled: !current,
    onFling,
  });

  // 次のカードが前に出る時、下に居た形（小さく薄い）から立ち上がる。
  // 初回表示では鳴らさん（読み込み直後に拡縮すると読みにくい）
  useEffect(() => {
    if (!current || current.id === prevTopId.current) return;
    const wasShown = prevTopId.current !== null;
    prevTopId.current = current.id;
    if (!wasShown) return;
    setSettleKey(current.id);
    const timer = window.setTimeout(() => setSettleKey(null), 300);
    return () => window.clearTimeout(timer);
  }, [current]);

  return (
    <div className="v2-meet-deck">
      {current ? (
        <MeetStage
          current={current}
          next={next}
          showUnder={dragging || flying}
          dragX={dragX}
          className={`${dragging ? "dragging" : ""} ${flying ? "fly" : ""} ${
            settleKey === current.id ? "settle" : ""
          }`}
          stamp={dragX >= 40 ? "keep" : dragX <= -40 ? "skip" : undefined}
          hintSeen={hintSeen}
          keepBusy={keepBusy}
          toast={toast}
          stageProps={stageProps}
          onSkip={() => fling("skip")}
          onKeep={() => fling("keep")}
          onViewKept={() => {
            setToast(null);
            onShowKept();
          }}
          onUndo={() => {
            setSkipped((prev) => prev.slice(0, -1));
            setToast(null);
          }}
          onRetry={(id) => {
            setToast(null);
            doKeep(id);
          }}
        />
      ) : (
        <>
          <MeetDeckEmpty onReset={() => setSkipped([])} />
          {toast && (
            <MeetToast
              toast={toast}
              onViewKept={() => {
                setToast(null);
                onShowKept();
              }}
              onUndo={() => {
                setSkipped((prev) => prev.slice(0, -1));
                setToast(null);
              }}
              onRetry={(id) => {
                setToast(null);
                doKeep(id);
              }}
            />
          )}
        </>
      )}
    </div>
  );
};

// ---- 一覧 ----

const matchesWant = (item: MeetCharacter, want: WantFilter, keptIds: Set<string>) => {
  switch (want) {
    case "official":
      return item.official;
    case "own":
      return item.own;
    case "talked":
      return item.lastTalkedAt !== null;
    case "kept":
      return keptIds.has(item.id);
    default:
      return true;
  }
};

const matchesChips = (item: MeetCharacter, chips: readonly string[]) =>
  chips.every((chip) => item.tags.some((tag) => tag.includes(chip)));

const ChipRow = ({
  label,
  row,
  selected,
  onToggle,
}: {
  label: string;
  row: readonly string[];
  selected: readonly string[];
  onToggle: (chip: string) => void;
}) => (
  <div role="group" aria-label={label} className="v2-meet-chips">
    {row.map((chip) => (
      <button
        key={chip}
        type="button"
        aria-pressed={selected.includes(chip)}
        className="v2-meet-chip"
        onClick={() => onToggle(chip)}
      >
        {selected.includes(chip) && (
          <span className="v2-meet-chip-check">
            <CheckIcon />
          </span>
        )}
        <span>{chip}</span>
      </button>
    ))}
  </div>
);

const MeetTile = ({ item }: { item: MeetCharacter }) => (
  <Link
    to="/characters/$id"
    params={{ id: item.id }}
    aria-label={`${item.name}のプロフィール`}
    className="v2-meet-tile"
  >
    <span className="v2-meet-tile-img">
      {item.avatar ? (
        <img src={avatarUrl(item.id, item.avatar) ?? undefined} alt="" loading="lazy" />
      ) : (
        <span aria-hidden="true" className={`v2-meet-tile-plate plate-${plateTone(item.id)}`}>
          {item.name.slice(0, 1)}
        </span>
      )}
      {item.own && <span className="v2-meet-badge top">つくった子</span>}
      {item.lastTalkedAt !== null && <span className="v2-meet-badge bottom">話したことがある</span>}
    </span>
    <span className="v2-meet-tile-text">
      <span className="v2-meet-tile-name">{item.name}</span>
      {item.tags[0] && <span className="v2-meet-tile-sub">{item.tags[0]}</span>}
    </span>
  </Link>
);

const MeetListEmpty = ({
  searching,
  query,
  want,
  onClear,
  onShowDeck,
}: {
  searching: boolean;
  query: string;
  want: WantFilter;
  onClear: () => void;
  onShowDeck: () => void;
}) => (
  <div className="v2-meet-state">
    <div className="v2-meet-state-title">
      {searching
        ? `「${query}」に合う子は、まだいません`
        : want === "kept"
          ? "まだ、とっておいた子はいません"
          : "見つかりませんでした"}
    </div>
    <div className="v2-meet-state-text">
      {searching
        ? "この言葉のまま、つくれます。"
        : want === "kept"
          ? "1 人ずつ見ている時に、とっておけます。"
          : "絞り込みを外すか、自分でつくれます。"}
    </div>
    <div className="v2-meet-state-actions">
      {searching ? (
        <Link to="/characters/new" className="v2-meet-quiet-button primary">
          「{query}」のままつくる
        </Link>
      ) : want === "kept" ? (
        <button type="button" className="v2-meet-quiet-button primary" onClick={onShowDeck}>
          1 人ずつ見る
        </button>
      ) : (
        <>
          <button type="button" className="v2-meet-quiet-button" onClick={onClear}>
            絞り込みを外す
          </button>
          <Link to="/characters/new" className="v2-meet-quiet-button primary">
            自分でつくる
          </Link>
        </>
      )}
    </div>
  </div>
);

const MeetWantSheet = ({
  want,
  keptCount,
  onPick,
  onClose,
}: {
  want: WantFilter;
  keptCount: number;
  onPick: (want: WantFilter) => void;
  onClose: () => void;
}) => (
  <div className="v2-make-scrim" onClick={onClose}>
    <div
      role="dialog"
      aria-modal="true"
      aria-label="見たい子"
      className="v2-make-sheet"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="v2-make-sheet-grabber" aria-hidden="true" />
      <div className="v2-make-sheet-head">
        <h2>見たい子</h2>
        <button
          type="button"
          aria-label="見たい子を閉じる"
          className="v2-make-icon-button"
          onClick={onClose}
        >
          <XIcon />
        </button>
      </div>
      <div className="v2-meet-want-list">
        {(Object.keys(WANT_LABELS) as WantFilter[]).map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={want === key}
            className="v2-meet-want-option"
            onClick={() => onPick(key)}
          >
            <span>{WANT_LABELS[key]}</span>
            {key === "kept" && keptCount > 0 && (
              <span className="v2-meet-want-count">{keptCount} 人</span>
            )}
            {want === key && (
              <span className="v2-meet-want-check">
                <CheckIcon />
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  </div>
);

const MeetListTools = ({
  searching,
  want,
  query,
  searchRef,
  onStartSearch,
  onStopSearch,
  onQuery,
  onOpenWant,
}: {
  searching: boolean;
  want: WantFilter;
  query: string;
  searchRef: React.RefObject<HTMLInputElement | null>;
  onStartSearch: () => void;
  onStopSearch: () => void;
  onQuery: (query: string) => void;
  onOpenWant: () => void;
}) => (
  <div className="v2-meet-tools">
    {searching ? (
      <>
        <input
          ref={searchRef}
          type="text"
          aria-label="名前でさがす"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          className="v2-meet-search"
        />
        <button
          type="button"
          aria-label="さがすのをやめる"
          className="v2-meet-search-button"
          onClick={onStopSearch}
        >
          <XIcon />
        </button>
      </>
    ) : (
      <>
        <button
          type="button"
          aria-label={`見たい子を選ぶ いまは${WANT_LABELS[want]}`}
          aria-haspopup="dialog"
          className="v2-meet-want"
          onClick={onOpenWant}
        >
          <span>{WANT_LABELS[want]}</span>
          <ChevronDownIcon />
        </button>
        <button
          type="button"
          aria-label="名前でさがす"
          className="v2-meet-search-button"
          onClick={onStartSearch}
        >
          <SearchIcon />
        </button>
      </>
    )}
  </div>
);

const MeetListView = ({
  items,
  keptIds,
  want,
  onWant,
  onShowDeck,
}: {
  items: MeetCharacter[];
  keptIds: Set<string>;
  want: WantFilter;
  onWant: (want: WantFilter) => void;
  onShowDeck: () => void;
}) => {
  const [chips, setChips] = useState<string[]>([]);
  const [wantOpen, setWantOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim();
    return items.filter(
      (item) =>
        matchesWant(item, want, keptIds) &&
        matchesChips(item, chips) &&
        (q === "" || item.name.includes(q)),
    );
  }, [items, want, chips, query, keptIds]);

  return (
    <div className="v2-meet-list">
      <ChipRow
        label="状況・関係で絞る"
        row={RELATION_CHIPS}
        selected={chips}
        onToggle={(chip) =>
          setChips((prev) =>
            prev.includes(chip) ? prev.filter((c) => c !== chip) : [...prev, chip],
          )
        }
      />
      <ChipRow
        label="相手の態度で絞る"
        row={ATTITUDE_CHIPS}
        selected={chips}
        onToggle={(chip) =>
          setChips((prev) =>
            prev.includes(chip) ? prev.filter((c) => c !== chip) : [...prev, chip],
          )
        }
      />
      <MeetListTools
        searching={searching}
        want={want}
        query={query}
        searchRef={searchRef}
        onStartSearch={() => {
          setSearching(true);
          requestAnimationFrame(() => searchRef.current?.focus());
        }}
        onStopSearch={() => {
          setSearching(false);
          setQuery("");
        }}
        onQuery={setQuery}
        onOpenWant={() => setWantOpen(true)}
      />
      {filtered.length > 0 ? (
        <div className="v2-meet-grid">
          {filtered.map((item) => (
            <MeetTile key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <MeetListEmpty
          searching={searching}
          query={query.trim()}
          want={want}
          onClear={() => {
            setChips([]);
            onWant("all");
          }}
          onShowDeck={onShowDeck}
        />
      )}
      {wantOpen && (
        <MeetWantSheet
          want={want}
          keptCount={keptIds.size}
          onPick={(key) => {
            onWant(key);
            setWantOpen(false);
          }}
          onClose={() => setWantOpen(false)}
        />
      )}
    </div>
  );
};

export const MeetScreen = ({ items }: { items: MeetCharacter[] }) => {
  const [mode, setMode] = useState<MeetMode>("deck");
  const [toast, setToast] = useState<Toast | null>(null);
  // とっておいた子の集合。読み込み時の keptAt に、この画面で付けた分を足す
  const [keptIds, setKeptIds] = useState<Set<string>>(
    () => new Set(items.filter((item) => item.keptAt !== null).map((item) => item.id)),
  );
  const [want, setWant] = useState<WantFilter>("all");

  // 知らせは 6 秒で消す（板は消え方を書いていないので、次の操作まで残り過ぎない程度）
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const onKept = (id: string) => setKeptIds((prev) => new Set(prev).add(id));

  return (
    <div className="v2-meet">
      <MeetHead mode={mode} onMode={setMode} />
      {mode === "deck" ? (
        <MeetDeck
          items={items}
          keptIds={keptIds}
          onKept={onKept}
          onShowKept={() => {
            setWant("kept");
            setMode("list");
          }}
          toast={toast}
          setToast={setToast}
        />
      ) : (
        <MeetListView
          items={items}
          keptIds={keptIds}
          want={want}
          onWant={setWant}
          onShowDeck={() => setMode("deck")}
        />
      )}
    </div>
  );
};
