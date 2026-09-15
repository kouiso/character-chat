import { useEffect, useMemo, useState } from "react";

import { useQuery } from "@tanstack/react-query";

import { AuthenticatedImage } from "@/component/ui/authenticated-image";
import { useChatQuery } from "@/hook/use-chat-query";
import { listConversations, searchConversationMessages, type ConversationSummary } from "@/lib/api";
import { queryKey } from "@/lib/query-key";

import { OU2 } from "./ouse-tokens";

interface OuLogScreenProps {
  onSelectConversation: (id: string, characterId?: string, focusMessageId?: string) => void;
}

// 会話一覧を日付単位でまとめるためのグループ表現。
interface DateGroup {
  label: string;
  items: ConversationSummary[];
}

const formatTime = (ts: number): string =>
  new Date(ts).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });

const logAvatarFallback = (name: string) => (
  <div
    style={{
      flex: "0 0 auto",
      width: 46,
      height: 46,
      borderRadius: "50%",
      background: OU2.ink,
      color: OU2.faint,
      display: "grid",
      placeItems: "center",
      fontFamily: OU2.serif,
      fontSize: 20,
      border: `1px solid ${OU2.lampDim}`,
    }}
  >
    {name[0]}
  </div>
);

// 「今夜=当日」、それ以外は M月D日 で見出しにする。
const groupLabel = (ts: number): string => {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "今夜";
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};

// 一覧側で照合できるのは手元に持っとる分（相手の名前・題・最後の一言）だけ。
// 本文そのものはサーバに問い合わせる。検索欄が「会話の中身も検索できます」と
// 名乗っとる以上、ここで止まると画面が嘘をつくことになる。
const matchesQuery = (conv: ConversationSummary, needle: string): boolean => {
  const hay = `${conv.characterName}\n${conv.title}\n${conv.lastAssistantMessage ?? ""}`;
  return hay.toLowerCase().includes(needle);
};

// 打つたびに投げると、一文字ごとにサーバを叩く。指が止まってから探しにいく。
const MESSAGE_SEARCH_DEBOUNCE_MS = 300;
const MESSAGE_SEARCH_MIN_CHARS = 2;

// updatedAt降順で並べつつ、隣接する同一日付をまとめる。降順のため見出しも新しい順に並ぶ。
const buildGroups = (conversations: ConversationSummary[], query: string): DateGroup[] => {
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? conversations.filter((conv) => matchesQuery(conv, needle))
    : conversations;
  const sorted = [...filtered].sort((a, b) => b.updatedAt - a.updatedAt);

  const groups: DateGroup[] = [];
  for (const conv of sorted) {
    const label = groupLabel(conv.updatedAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(conv);
    else groups.push({ label, items: [conv] });
  }
  return groups;
};

const SearchBar = ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
  <div style={{ padding: "0 24px 6px" }}>
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "11px 16px",
        borderRadius: 20,
        background: "rgba(20,15,13,.6)",
        border: `1px solid ${OU2.hairline}`,
      }}
    >
      <span style={{ color: OU2.lamp, fontFamily: OU2.round, fontSize: 12.5 }}>⌕</span>
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="会話の中身も検索できます…"
        aria-label="会話を検索"
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 44,
          border: "none",
          outline: "none",
          background: "transparent",
          color: OU2.text,
          fontFamily: OU2.round,
          fontSize: 12.5,
        }}
      />
    </div>
  </div>
);

const rowActionStyle = (color: string) => ({
  border: "none",
  background: "transparent",
  color,
  fontFamily: OU2.round,
  fontSize: 11,
  cursor: "pointer",
  padding: "6px 4px",
});

const ConversationRow = ({
  conv,
  onSelect,
  onDelete,
}: {
  conv: ConversationSummary;
  onSelect: () => void;
  onDelete: () => void;
}) => {
  // 一覧の中で消すので、ネイティブの confirm を出さずに行の中で二段にする。
  // 押し間違えても「やめる」で必ず戻れる状態にしておく。
  const [confirming, setConfirming] = useState(false);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        width: "100%",
        borderBottom: `1px solid ${OU2.hairline}`,
      }}
    >
      <button
        type="button"
        onClick={onSelect}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 13,
          flex: 1,
          minWidth: 0,
          padding: "11px 2px",
          border: "none",
          background: "transparent",
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        {conv.characterAvatar ? (
          <AuthenticatedImage
            src={conv.characterAvatar}
            alt=""
            style={{
              flex: "0 0 auto",
              width: 46,
              height: 46,
              borderRadius: "50%",
              objectFit: "cover",
              objectPosition: "50% 18%",
              border: `1px solid ${OU2.lampDim}`,
            }}
            loadingFallback={logAvatarFallback(conv.characterName)}
            fallback={logAvatarFallback(conv.characterName)}
          />
        ) : (
          <div
            style={{
              flex: "0 0 auto",
              width: 46,
              height: 46,
              borderRadius: "50%",
              background: OU2.ink,
              color: OU2.faint,
              display: "grid",
              placeItems: "center",
              fontFamily: OU2.serif,
              fontSize: 20,
              border: `1px solid ${OU2.lampDim}`,
            }}
          >
            {conv.characterName[0]}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
            <span
              style={{
                fontFamily: OU2.serif,
                fontSize: 15,
                color: OU2.text,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                minWidth: 0,
                maxWidth: "60%",
              }}
            >
              {conv.characterName}
            </span>
            <span
              style={{
                fontFamily: OU2.round,
                fontSize: 10.5,
                color: OU2.faint,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                minWidth: 0,
                flex: 1,
              }}
            >
              {conv.title}
            </span>
          </div>
          <div
            style={{
              marginTop: 3,
              fontFamily: OU2.serif,
              fontStyle: "italic",
              fontSize: 11.5,
              color: OU2.dim,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {conv.lastAssistantMessage ?? conv.characterGreeting}
          </div>
        </div>
        <div style={{ flex: "0 0 auto", textAlign: "right" }}>
          <div style={{ fontFamily: OU2.round, fontSize: 10.5, color: OU2.faint }}>
            {formatTime(conv.updatedAt)}
          </div>
          <div style={{ fontFamily: OU2.round, fontSize: 11, color: OU2.lamp, marginTop: 4 }}>
            つづき →
          </div>
        </div>
      </button>
      {confirming ? (
        <div style={{ flex: "0 0 auto", display: "flex", gap: 6, paddingLeft: 8 }}>
          <button
            type="button"
            onClick={() => {
              setConfirming(false);
              onDelete();
            }}
            style={rowActionStyle(OU2.lamp)}
          >
            消す
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            style={rowActionStyle(OU2.faint)}
          >
            やめる
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          aria-label={`${conv.characterName}との会話を削除`}
          style={{ ...rowActionStyle(OU2.faint), paddingLeft: 10, paddingRight: 2 }}
        >
          削除
        </button>
      )}
    </div>
  );
};

export const OuLogScreen = ({ onSelectConversation }: OuLogScreenProps) => {
  const [query, setQuery] = useState("");
  const [settledQuery, setSettledQuery] = useState("");
  // 一覧の画面なので開いとる会話は無い。
  const { deleteConversationEntry } = useChatQuery(null);
  const { data: conversations = [] } = useQuery({
    queryKey: queryKey.conversationList,
    queryFn: listConversations,
  });

  useEffect(() => {
    const timer = setTimeout(() => setSettledQuery(query), MESSAGE_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const needle = settledQuery.trim();
  const { data: messageHits = [] } = useQuery({
    queryKey: ["conversation-message-search", needle],
    queryFn: () => searchConversationMessages(needle),
    enabled: needle.length >= MESSAGE_SEARCH_MIN_CHARS,
  });

  const groups = useMemo(() => buildGroups(conversations, query), [conversations, query]);
  // 一覧側で既に当たっとる会話は出さん。同じ会話が上下に二度並ぶだけで、
  // 「本文で当たった」という情報が薄まる。
  const listedIds = useMemo(
    () => new Set(groups.flatMap((group) => group.items.map((conv) => conv.id))),
    [groups],
  );
  const bodyHits = useMemo(
    () => messageHits.filter((hit) => !listedIds.has(hit.conversationId)),
    [messageHits, listedIds],
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ flex: "0 0 auto", padding: "14px 26px 8px" }}>
        <div style={{ fontFamily: OU2.serif, fontSize: 23, fontWeight: 600, color: OU2.text }}>
          履歴
        </div>
      </div>
      <div style={{ flex: "0 0 auto" }}>
        <SearchBar value={query} onChange={setQuery} />
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          scrollbarWidth: "none",
          padding: "8px 24px 104px",
        }}
      >
        {groups.length === 0 && bodyHits.length === 0 ? (
          <div
            style={{
              padding: "48px 8px",
              textAlign: "center",
              fontFamily: OU2.round,
              fontSize: 12,
              color: OU2.faint,
            }}
          >
            {query.trim() ? "見つかりませんでした" : "まだ会話がありません"}
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.label}>
              <div
                style={{
                  fontFamily: OU2.round,
                  fontSize: 10.5,
                  letterSpacing: ".18em",
                  color: OU2.faint,
                  margin: "16px 2px 8px",
                }}
              >
                {group.label}
              </div>
              {group.items.map((conv) => (
                <ConversationRow
                  key={conv.id}
                  conv={conv}
                  onSelect={() => onSelectConversation(conv.id, conv.characterId)}
                  onDelete={() => {
                    void deleteConversationEntry(conv.id);
                  }}
                />
              ))}
            </div>
          ))
        )}
        {bodyHits.length > 0 && (
          <div>
            <div
              style={{
                fontFamily: OU2.round,
                fontSize: 10.5,
                letterSpacing: ".18em",
                color: OU2.faint,
                margin: "16px 2px 8px",
              }}
            >
              本文の中から
            </div>
            {bodyHits.map((hit) => (
              <button
                key={hit.messageId}
                type="button"
                onClick={() => onSelectConversation(hit.conversationId, undefined, hit.messageId)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "11px 2px",
                  background: "transparent",
                  cursor: "pointer",
                }}
              >
                <div
                  style={{
                    fontFamily: OU2.round,
                    fontSize: 11,
                    color: OU2.faint,
                    marginBottom: 3,
                  }}
                >
                  {hit.characterName}・{hit.conversationTitle}
                </div>
                <div
                  style={{
                    fontFamily: OU2.round,
                    fontSize: 12.5,
                    lineHeight: 1.7,
                    color: OU2.text,
                  }}
                >
                  {hit.snippet}
                </div>
              </button>
            ))}
          </div>
        )}
        <div
          style={{
            textAlign: "center",
            fontFamily: OU2.round,
            fontSize: 11,
            color: OU2.faint,
            padding: "14px 0 4px",
          }}
        >
          タップでその夜のつづきへ ・ 消しても、彼女の記憶は残ります
        </div>
      </div>
    </div>
  );
};
