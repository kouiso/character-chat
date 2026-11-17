import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router";

import {
  ListConnectionState,
  ListErrorState,
  ListLoadingState,
} from "../component/list-route-state";
import { avatarUrl } from "../lib/avatar-url";
import { listCharacters, listSavedConversations } from "../server/characters";

import "../component/home-screen.css";

import type { CharacterListItem } from "../server/characters";
import type { ConversationSummaryRow } from "@v2/db";

const routeApi = getRouteApi("/");

const WEEKDAYS = ["日曜", "月曜", "火曜", "水曜", "木曜", "金曜", "土曜"] as const;

const dayStart = (time: number) => {
  const d = new Date(time);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

// 暦の語はひらがな（きょう・きのう）。1 週間以内は曜日、それより前は日付（CAST.md）
const formatHomeDay = (time: number) => {
  const diffDays = Math.round((dayStart(Date.now()) - dayStart(time)) / 86_400_000);
  if (diffDays <= 0) return "きょう";
  if (diffDays === 1) return "きのう";
  if (diffDays < 7) return WEEKDAYS[new Date(time).getDay()];
  const d = new Date(time);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};

const formatHomeTime = (time: number) => {
  const d = new Date(time);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
};

// セリフの吹き出しと行のプレビューは板どおり「」で包む。本文に既に括弧があればそのまま
const quoteLine = (text: string) => (text.startsWith("「") ? text : `「${text}」`);

const ArrowRight = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M5 12h14" />
    <path d="M13 6l6 6-6 6" />
  </svg>
);

const PinIcon = () => (
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

const ChevronRight = () => (
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

const LampIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M9 17h6" />
    <path d="M10 20h4" />
    <path d="M8.5 14a6 6 0 1 1 7 0c-.6.5-1 1.2-1 2v1h-5v-1c0-.8-.4-1.5-1-2z" />
  </svg>
);

const facePalette = ["#2E2A4A", "#1E3437", "#3B2630", "#38291C"] as const;

// 顔の絵が無い子は名前の頭文字を色つきの札に載せる（Kit「頭文字の札」）
const FaceInitial = ({ name, index }: { name: string; index: number }) => (
  <span
    className="v2-home-continuation-face"
    style={{ background: facePalette[index % facePalette.length] }}
    aria-hidden="true"
  >
    {name.slice(0, 1)}
  </span>
);

type Continuation = { conversation: ConversationSummaryRow; character: CharacterListItem };

const ContinuationRow = ({ conversation, character, index }: Continuation & { index: number }) => {
  const face = avatarUrl(character.id, character.avatar);
  return (
    <li>
      <Link
        to="/chat/$id"
        params={{ id: character.id }}
        search={{ conversationId: conversation.id }}
        className="v2-home-continuation"
        aria-label={`${character.name}との会話をつづきから話す`}
      >
        {face ? (
          <span className="v2-home-continuation-face">
            <img src={face} alt="" loading="lazy" />
          </span>
        ) : (
          <FaceInitial name={character.name} index={index} />
        )}
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
    </li>
  );
};

const HomeEmpty = () => (
  <div className="v2-home-empty">
    <span className="v2-home-empty-icon" aria-hidden="true">
      <LampIcon />
    </span>
    <h1>まだ、いつもの子はいません</h1>
    <div className="v2-home-empty-note">話しはじめた子が、ここで迎えてくれます。</div>
    <Link to="/catalog" className="v2-home-primary">
      <span>出会うへ</span>
      <ArrowRight />
    </Link>
  </div>
);

const HomeMain = ({
  hero,
  latest,
  continuations,
}: {
  hero: CharacterListItem;
  latest?: ConversationSummaryRow;
  continuations: Continuation[];
}) => (
  <>
    <div className="v2-home-hero">
      {hero.avatar && <img src={avatarUrl(hero.id, hero.avatar) ?? undefined} alt={hero.name} />}
      <div className="v2-home-hero-edge" aria-hidden="true" />
      <Link
        to="/characters/$id"
        params={{ id: hero.id }}
        className="v2-home-plate"
        aria-label={`いつもの子（プロフィールで留めた子）${hero.name}のプロフィール`}
      >
        <PinIcon />
        <span>いつもの子</span>
      </Link>
    </div>
    <div className="v2-home-sheet">
      {latest && (
        <div className="v2-home-arrival">
          <span className="v2-home-arrival-dot" aria-hidden="true" />
          <span className="v2-home-arrival-new">新着</span>
          <span>
            {formatHomeDay(latest.updatedAt)} {formatHomeTime(latest.updatedAt)}
          </span>
        </div>
      )}
      <div className="v2-home-name">
        <h1>{hero.name}</h1>
      </div>
      {latest?.lastMessage && <div className="v2-home-bubble">{quoteLine(latest.lastMessage)}</div>}
      <Link
        to="/chat/$id"
        params={{ id: hero.id }}
        search={latest ? { conversationId: latest.id } : {}}
        className="v2-home-primary"
        aria-label={latest ? `${hero.name}と、ゆうべのつづきを話す` : `${hero.name}と話す`}
      >
        <span>{latest ? "ゆうべのつづき" : "話す"}</span>
        <ArrowRight />
      </Link>
      {continuations.length > 0 && (
        <>
          <div className="v2-home-section">
            <h2>つづきから</h2>
            {/* 履歴の画面は未着工。行き先ができたら差し替える */}
            <Link to="/my" className="v2-home-history">
              <span>履歴</span>
              <ChevronRight />
            </Link>
          </div>
          <ul className="v2-home-continuations">
            {continuations.map(({ conversation, character }, index) => (
              <ContinuationRow
                key={conversation.id}
                conversation={conversation}
                character={character}
                index={index}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  </>
);

const HomePage = () => {
  const { characters, conversations } = routeApi.useLoaderData();
  const byId = new Map(characters.map((c) => [c.id, c]));

  // 「いつもの子」は留める枠がまだ無いので、いちばん新しく話した子を主役にする。
  // 会話が 1 件も無い時は一覧の先頭の子を迎える。
  const latest = conversations.find((conversation) => byId.has(conversation.characterId));
  const hero = latest ? byId.get(latest.characterId) : characters[0];
  const continuations = conversations.flatMap((conversation) => {
    const character = byId.get(conversation.characterId);
    return character && conversation.id !== latest?.id ? [{ conversation, character }] : [];
  });

  return (
    <div className="v2-home">
      <ListConnectionState />
      {hero ? (
        <HomeMain hero={hero} latest={latest} continuations={continuations} />
      ) : (
        <HomeEmpty />
      )}
    </div>
  );
};

export const Route = createFileRoute("/")({
  pendingComponent: ListLoadingState,
  errorComponent: ListErrorState,
  loader: async ({ abortController }) => {
    const [characters, conversations] = await Promise.all([
      listCharacters({ signal: abortController.signal }),
      listSavedConversations({ signal: abortController.signal }),
    ]);
    return { characters, conversations };
  },
  component: HomePage,
});
