import { useQuery } from "@tanstack/react-query";

import { listConversations, type Character } from "@/lib/api";
import { recentConversations } from "@/lib/conversation-recent";
import { queryKey } from "@/lib/query-key";

import { ChatscopeCharacterList, ChatscopeRecentList } from "./chatscope-conversation-item";
import { OuFlameMark } from "./ou-logo";
import { OU2 } from "./ouse-tokens";

interface OuHomeScreenProps {
  characters: Character[];
  activeCharacterId?: string | null;
  activeConversationId?: string | null;
  onSelectCharacter: (id: string) => void;
  onSelectConversation: (id: string, characterId?: string) => void;
  onDiscover: () => void;
  onCreate: () => void;
}

const greeting = (): string => {
  const hour = new Date().getHours();
  if (hour < 5) return "夜更けですね";
  if (hour < 11) return "おはようございます";
  if (hour < 17) return "こんにちは";
  return "こんばんは";
};

export const OuHomeScreen = ({
  characters,
  activeCharacterId,
  activeConversationId,
  onSelectCharacter,
  onSelectConversation,
  onDiscover,
  onCreate,
}: OuHomeScreenProps) => {
  const { data: conversations = [] } = useQuery({
    queryKey: queryKey.conversationList,
    queryFn: listConversations,
  });
  const recent = recentConversations(conversations, 5);

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "18px 18px 104px" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: OU2.text }}>
          <OuFlameMark size={22} glow cutout={OU2.night} />
          <span style={{ fontFamily: OU2.serif, fontSize: 22, letterSpacing: "0.14em" }}>燈</span>
        </div>
        <span style={{ fontFamily: OU2.round, fontSize: 12, color: OU2.lampDim }}>
          {greeting()}
        </span>
      </header>

      <section style={{ marginTop: 28 }}>
        <div
          style={{
            fontFamily: OU2.round,
            fontSize: 12,
            letterSpacing: "0.22em",
            color: OU2.lampDim,
            marginBottom: 12,
          }}
        >
          つづきから
        </div>
        <ChatscopeRecentList
          conversations={recent}
          activeConversationId={activeConversationId}
          onSelectConversation={onSelectConversation}
        />
      </section>

      <section style={{ marginTop: 28 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <div
            style={{
              fontFamily: OU2.round,
              fontSize: 12,
              letterSpacing: "0.22em",
              color: OU2.lampDim,
            }}
          >
            今夜の出会い
          </div>
          <button
            type="button"
            onClick={onDiscover}
            style={{
              display: "inline-flex",
              alignItems: "center",
              border: "none",
              background: "transparent",
              color: OU2.lamp,
              fontFamily: OU2.round,
              fontSize: 12,
              minHeight: 44,
              padding: "0 4px",
              cursor: "pointer",
            }}
          >
            さがす →
          </button>
        </div>
        <ChatscopeCharacterList
          characters={characters.slice(0, 8)}
          activeCharacterId={activeCharacterId}
          onSelectCharacter={onSelectCharacter}
        />
      </section>
      <button
        type="button"
        onClick={() => onCreate()}
        style={{
          marginTop: 24,
          width: "100%",
          padding: "15px 14px",
          borderRadius: 14,
          border: `1px dashed ${OU2.lampDim}`,
          background: "transparent",
          color: OU2.lamp,
          fontFamily: OU2.serif,
          fontSize: 14,
          letterSpacing: "0.04em",
          cursor: "pointer",
        }}
      >
        ✦ 会いたい子がいない夜は — つくる →
      </button>
    </div>
  );
};
