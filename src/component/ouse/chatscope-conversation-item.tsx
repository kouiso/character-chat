import type { KeyboardEvent } from "react";

import { Avatar, Conversation, ConversationList } from "@chatscope/chat-ui-kit-react";

import { AuthenticatedImage } from "@/component/ui/authenticated-image";
import type { Character, ConversationSummary } from "@/lib/api";
import { visibleCharacterTags } from "@/lib/character-display-tag";

import { CharacterName } from "./character-name";
import { OU2 } from "./ouse-tokens";

// キャラカード・会話履歴を chatscope の Conversation 行に寄せ、燈デザインを維持する

const traitLine = (character: Character): string =>
  visibleCharacterTags(character.tags)[0] ?? character.greeting.slice(0, 22);

const relativeTime = (ts: number): string => {
  const diff = Date.now() - ts;
  if (diff < 60 * 60 * 1000) return `${Math.max(1, Math.floor(diff / 60000))}分前`;
  if (diff < 6 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)}時間前`;
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "昨夜";
  if (diff < 7 * 86400000) return d.toLocaleDateString("ja-JP", { weekday: "short" });
  return d.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
};

const avatarFallback = (name: string) => (
  <div
    style={{
      width: "100%",
      height: "100%",
      borderRadius: "50%",
      background: OU2.ink,
      display: "grid",
      placeItems: "center",
      fontFamily: OU2.serif,
      fontSize: 22,
      color: OU2.faint,
    }}
  >
    {name[0]}
  </div>
);

const avatarStyle = {
  width: 52,
  height: 52,
  minWidth: 52,
  minHeight: 52,
  overflow: "hidden",
  border: `1px solid ${OU2.hairline}`,
} as const;

const imageStyle = {
  width: "100%",
  height: "100%",
  objectFit: "cover" as const,
  borderRadius: "50%",
};

const nameStyle = {
  fontFamily: OU2.serif,
  fontSize: 16,
  color: OU2.text,
  whiteSpace: "nowrap" as const,
  overflow: "hidden" as const,
  textOverflow: "ellipsis" as const,
  minWidth: 0,
};

const infoStyle = {
  marginTop: 2,
  fontFamily: OU2.round,
  fontSize: 12,
  color: OU2.dim,
  whiteSpace: "nowrap" as const,
  overflow: "hidden" as const,
  textOverflow: "ellipsis" as const,
};

const handleKeySelect = (event: KeyboardEvent<HTMLDivElement>, onSelect: () => void) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    onSelect();
  }
};

const AvatarImage = ({ src, name }: { src: string | null; name: string }) => (
  <AuthenticatedImage
    src={src}
    alt={name}
    style={imageStyle}
    loadingFallback={avatarFallback(name)}
    fallback={avatarFallback(name)}
  />
);

const characterConversation = ({
  character,
  active,
  onSelect,
}: {
  character: Character;
  active: boolean;
  onSelect: (id: string) => void;
}) => (
  <Conversation
    key={character.id}
    active={active}
    data-testid="character-card"
    onClick={() => onSelect(character.id)}
    onKeyDown={(event) => handleKeySelect(event, () => onSelect(character.id))}
    role="button"
    tabIndex={0}
    aria-label={`${character.name}のプロフィールを開く`}
  >
    <Avatar name={character.name} style={avatarStyle}>
      <AvatarImage src={character.avatar} name={character.name} />
    </Avatar>
    <Conversation.Content>
      <div style={nameStyle}>
        <CharacterName name={character.name} reading={character.nameReading} />
      </div>
      <div style={infoStyle}>{traitLine(character)}</div>
    </Conversation.Content>
  </Conversation>
);

interface ChatscopeCharacterListProps {
  characters: Character[];
  activeCharacterId?: string | null;
  onSelectCharacter: (id: string) => void;
}

export const ChatscopeCharacterList = ({
  characters,
  activeCharacterId,
  onSelectCharacter,
}: ChatscopeCharacterListProps) => (
  <ConversationList scrollable={false} className="chatscope-ouse-conversations">
    {characters.map((character) =>
      characterConversation({
        character,
        active: character.id === activeCharacterId,
        onSelect: onSelectCharacter,
      }),
    )}
  </ConversationList>
);

const recentConversation = ({
  conversation,
  active,
  onSelect,
}: {
  conversation: ConversationSummary;
  active: boolean;
  onSelect: (conversationId: string, characterId?: string) => void;
}) => {
  const info = conversation.parentConversationId
    ? `${conversation.characterName}: ${conversation.lastAssistantMessage ?? conversation.characterGreeting}`
    : (conversation.lastAssistantMessage ?? conversation.characterGreeting);
  const hasTitle = conversation.title !== "新しい会話";

  return (
    <Conversation
      key={conversation.id}
      active={active}
      lastActivityTime={relativeTime(conversation.updatedAt)}
      onClick={() => onSelect(conversation.id, conversation.characterId)}
      onKeyDown={(event) =>
        handleKeySelect(event, () => onSelect(conversation.id, conversation.characterId))
      }
      role="button"
      tabIndex={0}
      aria-label={`${conversation.characterName}との会話を開く`}
    >
      <Avatar name={conversation.characterName} style={avatarStyle}>
        <AvatarImage src={conversation.characterAvatar} name={conversation.characterName} />
      </Avatar>
      <Conversation.Content>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 8,
            minWidth: 0,
            overflow: "hidden",
          }}
        >
          <span style={nameStyle}>{conversation.characterName}</span>
          {conversation.parentConversationId && (
            <span
              style={{
                flexShrink: 0,
                fontFamily: OU2.round,
                fontSize: 10,
                color: OU2.lamp,
                border: `1px solid ${OU2.lampDim}`,
                borderRadius: 99,
                padding: "1px 6px",
              }}
            >
              宴
            </span>
          )}
          {hasTitle && (
            <span
              style={{
                flex: 1,
                minWidth: 0,
                fontFamily: OU2.round,
                fontSize: 10,
                color: OU2.faint,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {conversation.title}
            </span>
          )}
        </div>
        <div style={infoStyle}>{info}</div>
      </Conversation.Content>
    </Conversation>
  );
};

interface ChatscopeRecentListProps {
  conversations: ConversationSummary[];
  activeConversationId?: string | null;
  onSelectConversation: (conversationId: string, characterId?: string) => void;
}

export const ChatscopeRecentList = ({
  conversations,
  activeConversationId,
  onSelectConversation,
}: ChatscopeRecentListProps) => (
  <ConversationList scrollable={false} className="chatscope-ouse-conversations">
    {conversations.map((conversation) =>
      recentConversation({
        conversation,
        active: conversation.id === activeConversationId,
        onSelect: onSelectConversation,
      }),
    )}
  </ConversationList>
);
