// ホーム（板 Main・HomeEmpty・HomeStates）。「いつもの子」（留めた子）か
// 「さいきん話した子」が迎え、つづきから（会話＋グループ）を時系列で並べる。
import { Link } from "@tanstack/react-router";

import { avatarUrl } from "../lib/avatar-url";

import {
  AlertIcon,
  ArrowRightIcon,
  ClockIcon,
  LampIcon,
  RetryFillButton,
  ScreenBand,
  ScreenBlock,
  SkeletonRow,
  Skel,
} from "./screen-state";

import type { ConversationSummaryRow, GroupContinuationRow } from "@v2/db";
import type { CharacterListItem } from "../server/characters";

import "./home-screen.css";

const WEEKDAYS = ["日曜", "月曜", "火曜", "水曜", "木曜", "金曜", "土曜"] as const;

const dayStart = (time: number) => {
  const d = new Date(time);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

// 暦の語はひらがな（きょう・きのう）。1 週間以内は曜日、それより前は日付（WORDING.md）
export const formatHomeDay = (time: number) => {
  const diffDays = Math.round((dayStart(Date.now()) - dayStart(time)) / 86_400_000);
  if (diffDays <= 0) return "きょう";
  if (diffDays === 1) return "きのう";
  if (diffDays < 7) return WEEKDAYS[new Date(time).getDay()];
  const d = new Date(time);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};

export const formatHomeTime = (time: number) => {
  const d = new Date(time);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
};

// セリフの吹き出しと行のプレビューは板どおり「」で包む。本文に既に括弧があればそのまま
const quoteLine = (text: string) => (text.startsWith("「") ? text : `「${text}」`);

const TackIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M9 4h6l-1 6 3 3H7l3-3-1-6z" />
    <path d="M12 13v7" />
  </svg>
);

const ChevronRightIcon = () => (
  <svg
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

// 絵が無い子の頭文字の札は 4 色から。同じ子はいつも同じ色（KIT 6.12）
const initialPalette = [
  "var(--color-initial-plate-1)",
  "var(--color-initial-plate-2)",
  "var(--color-initial-plate-3)",
  "var(--color-initial-plate-4)",
] as const;

const initialColor = (id: string) => {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.codePointAt(0)!) % 997;
  return initialPalette[hash % initialPalette.length];
};

const FaceTile = ({
  character,
  className,
}: {
  character: { id: string; name: string; avatar: string | null };
  className: string;
}) => {
  const face = avatarUrl(character.id, character.avatar);
  return (
    <span
      className={className}
      style={face ? undefined : { background: initialColor(character.id) }}
      aria-hidden="true"
    >
      {face ? <img src={face} alt="" loading="lazy" /> : character.name.slice(0, 1)}
    </span>
  );
};

// いつもの子（プロフィールで留めた子）は画鋲、留めが無い時はさいきん話した子（時計）
export const HomeHeroPlate = ({
  character,
  pinned,
}: {
  character: CharacterListItem;
  pinned: boolean;
}) => (
  <Link
    to="/characters/$id"
    params={{ id: character.id }}
    className="v2-home-plate"
    aria-label={
      pinned
        ? `いつもの子（プロフィールで留めた子）${character.name}のプロフィール`
        : `さいきん話した子 ${character.name}のプロフィール`
    }
  >
    <span className="v2-home-plate-icon">{pinned ? <TackIcon /> : <ClockIcon />}</span>
    <span>{pinned ? "いつもの子" : "さいきん話した子"}</span>
  </Link>
);

export type HomeContinuation =
  | { kind: "chat"; conversation: ConversationSummaryRow; character: CharacterListItem }
  | {
      kind: "group";
      group: GroupContinuationRow;
      speaker: CharacterListItem | undefined;
      faces: CharacterListItem[];
    };

const ChatContinuationRow = ({
  conversation,
  character,
}: {
  conversation: ConversationSummaryRow;
  character: CharacterListItem;
}) => (
  <li className="v2-home-continuation-item">
    <Link
      to="/chat/$id"
      params={{ id: character.id }}
      search={{ conversationId: conversation.id }}
      className="v2-home-continuation"
      aria-label={`${character.name}との会話をつづきから話す`}
    >
      <FaceTile character={character} className="v2-home-continuation-face" />
      <span className="v2-home-continuation-body">
        <span className="v2-home-continuation-name">{character.name}</span>
        <span className="v2-home-continuation-preview">
          {conversation.lastMessage
            ? quoteLine(conversation.lastMessage)
            : conversation.title || "無題の会話"}
        </span>
      </span>
      <span className="v2-home-continuation-day">{formatHomeDay(conversation.updatedAt)}</span>
    </Link>
    <Link
      to="/chat/$id"
      params={{ id: character.id }}
      search={{ newChat: crypto.randomUUID() }}
      className="v2-home-continuation-new"
      aria-label={`${character.name}と新しい会話を始める`}
    >
      新しい会話
    </Link>
  </li>
);

// 場の行は先頭メンバー 2 人の顔を重ねる（板 HomeStates「つづきからにグループがある時」）
const GroupContinuationRow = ({
  group,
  speaker,
  faces,
}: {
  group: GroupContinuationRow;
  speaker: CharacterListItem | undefined;
  faces: CharacterListItem[];
}) => (
  <li className="v2-home-continuation-item">
    <Link
      to="/groups/$id"
      params={{ id: group.id }}
      className="v2-home-continuation"
      aria-label={`${group.title}との会話をつづきから話す`}
    >
      {faces.length > 1 ? (
        <span className="v2-home-continuation-faces" aria-hidden="true">
          <FaceTile character={faces[0]} className="v2-home-continuation-faces-back" />
          <FaceTile character={faces[1]} className="v2-home-continuation-faces-front" />
        </span>
      ) : faces[0] ? (
        <FaceTile character={faces[0]} className="v2-home-continuation-face" />
      ) : (
        <span
          className="v2-home-continuation-face"
          style={{ background: initialColor(group.id) }}
          aria-hidden="true"
        >
          {group.title.slice(0, 1)}
        </span>
      )}
      <span className="v2-home-continuation-body">
        <span className="v2-home-continuation-name">{group.title}</span>
        <span className="v2-home-continuation-preview">
          {group.lastMessage
            ? `${speaker ? `${speaker.name}` : ""}${quoteLine(group.lastMessage)}`
            : group.title}
        </span>
      </span>
      <span className="v2-home-continuation-day">{formatHomeDay(group.updatedAt)}</span>
    </Link>
  </li>
);

export type HomeHeroData = {
  character: CharacterListItem;
  // 「いつもの子」に留める枠はまだ無い（Profile 板の「いつもの子にする」が着いたら繋ぐ）。
  pinned: boolean;
  latest: ConversationSummaryRow;
};

// 主役が居る時の絵の頭（シートの外）
const HomeHeroSection = ({ hero }: { hero: HomeHeroData }) => {
  const { character, pinned } = hero;
  const face = avatarUrl(character.id, character.avatar);
  return (
    <div className="v2-home-hero">
      {face ? (
        <img src={face} alt={character.name} />
      ) : (
        <span
          className="v2-home-hero-initial"
          style={{ background: initialColor(character.id) }}
          aria-hidden="true"
        >
          {character.name.slice(0, 1)}
        </span>
      )}
      <div className="v2-home-hero-edge" aria-hidden="true" />
      <HomeHeroPlate character={character} pinned={pinned} />
    </div>
  );
};

// 主役が居る時のシートの頭（新着・名前・吹き出し・主ボタン）
const HomeHeroSheetTop = ({ hero }: { hero: HomeHeroData }) => {
  const { character, latest } = hero;
  const subtitle = character.tags?.[0];
  const bubble = latest.lastMessage ? quoteLine(latest.lastMessage) : null;
  return (
    <>
      <div className="v2-home-arrival">
        <span className="v2-home-arrival-dot" aria-hidden="true" />
        <span className="v2-home-arrival-new">新着</span>
        <span>
          {formatHomeDay(latest.updatedAt)} {formatHomeTime(latest.updatedAt)}
        </span>
      </div>
      <div className="v2-home-name">
        <h1>{character.name}</h1>
        {subtitle && <span className="v2-home-name-sub">{subtitle}</span>}
      </div>
      {bubble && (
        <div className="v2-home-bubble">
          <span className="v2-home-bubble-text">{bubble}</span>
        </div>
      )}
      <Link
        to="/chat/$id"
        params={{ id: character.id }}
        search={{ conversationId: latest.id }}
        className="v2-fill-btn v2-home-primary"
        aria-label={`${character.name}と、ゆうべのつづきを話す`}
      >
        <span>ゆうべのつづき</span>
        <ArrowRightIcon />
      </Link>
      <Link
        to="/chat/$id"
        params={{ id: character.id }}
        search={{ newChat: crypto.randomUUID() }}
        className="v2-home-secondary"
        aria-label={`${character.name}と新しい会話を始める`}
      >
        新しい会話
      </Link>
    </>
  );
};

export const HomeScreen = ({
  hero,
  continuations,
}: {
  // 主役（いつもの子・さいきん話した子）。1 対 1 の会話が無く場だけある時は無し。
  hero: HomeHeroData | undefined;
  continuations: HomeContinuation[];
}) => (
  <>
    {hero && <HomeHeroSection hero={hero} />}
    <div className={hero ? "v2-home-sheet" : "v2-home-sheet v2-home-sheet--top"}>
      <div className="v2-home-topbar">
        <Link to="/settings" className="v2-home-settings" aria-label="設定を開く">
          設定
        </Link>
      </div>
      {hero && <HomeHeroSheetTop hero={hero} />}
      {continuations.length > 0 && (
        <>
          <div className="v2-home-section">
            <h2>つづきから</h2>
            {/* 履歴の画面は未着工。行き先ができたら差し替える */}
            <Link to="/my" className="v2-home-history">
              <span>履歴</span>
              <ChevronRightIcon />
            </Link>
          </div>
          <ul className="v2-home-continuations">
            {continuations.map((item) =>
              item.kind === "chat" ? (
                <ChatContinuationRow
                  key={item.conversation.id}
                  conversation={item.conversation}
                  character={item.character}
                />
              ) : (
                <GroupContinuationRow
                  key={item.group.id}
                  group={item.group}
                  speaker={item.speaker}
                  faces={item.faces}
                />
              ),
            )}
          </ul>
        </>
      )}
    </div>
  </>
);

// いつもの子がまだいない時（HomeEmpty 上段）: 迎える子が居ない空の画面
export const HomeEmptyScreen = () => (
  <ScreenBlock
    role="status"
    iconTone="peach"
    icon={<LampIcon />}
    title="まだ、いつもの子はいません"
    note="話しはじめた子が、ここで迎えてくれます。"
  >
    <Link to="/catalog" className="v2-fill-btn">
      <span>出会うへ</span>
      <ArrowRightIcon />
    </Link>
  </ScreenBlock>
);

// 読み込み中（HomeStates「読み込み中」）: 出てくる物と同じ形の骨組み。
// 長引いた時は下の帯に「時間がかかっています」を足す。
export const HomeLoadingScreen = ({ slow, onRetry }: { slow: boolean; onRetry: () => void }) => (
  <div className={slow ? "v2-home v2-home--band" : "v2-home"}>
    <div className="v2-home-hero v2-home-hero--skel v2-skel-anim" aria-hidden="true">
      <div className="v2-home-hero-edge" />
    </div>
    <div role="status" aria-label="読み込んでいます" className="v2-home-sheet">
      <div className="v2-skel-anim">
        <div className="v2-home-skel-meta">
          <Skel width={112} height={12} hi />
        </div>
        <div className="v2-home-skel-name">
          <Skel width={136} height={28} hi />
          <Skel width={120} height={12} />
        </div>
        <span className="v2-skel v2-home-skel-bubble" />
        <span className="v2-skel v2-home-skel-btn v2-skel--hi" />
      </div>
      <div className="v2-home-section">
        <h2>つづきから</h2>
        <Link to="/my" className="v2-home-history">
          <span>履歴</span>
          <ChevronRightIcon />
        </Link>
      </div>
      <div className="v2-skel-anim">
        <SkeletonRow nameWidth={72} lineWidth={168} />
      </div>
    </div>
    {slow && <ScreenBand kind="status" text="時間がかかっています" onRetry={onRetry} tab />}
  </div>
);

// 読めない時・まだ何も出ていない時のオフライン（HomeStates）。次の一手は「もう一度」だけ。
export const HomeErrorScreen = ({
  offline,
  onRetry,
}: {
  offline: boolean;
  onRetry: () => void;
}) => (
  <div className="v2-home">
    <ScreenBlock
      role="alert"
      iconTone="danger"
      icon={<AlertIcon />}
      title={offline ? "オフラインです" : "ホームを読み込めませんでした"}
      note={offline ? "つながったら、もう一度読み込めます。" : undefined}
    >
      <RetryFillButton onRetry={onRetry} />
    </ScreenBlock>
  </div>
);
