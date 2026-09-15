import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Pencil, Settings } from "lucide-react";

import { AuthenticatedImage } from "@/component/ui/authenticated-image";
import { listConversations, type Character } from "@/lib/api";
import { visibleCharacterTags } from "@/lib/character-display-tag";
import { queryKey } from "@/lib/query-key";

import { CharacterName } from "./character-name";
import { OU2 } from "./ouse-tokens";

interface OuMyScreenProps {
  characters: Character[];
  onCreate: () => void;
  onSettings: () => void;
  onTalk: (id: string) => void;
  onEdit: (id: string) => void;
  onMemory: () => void;
  onLog: () => void;
  onUtage: () => void;
}

const metaLine = (character: Character, conversationCount: number): string =>
  [visibleCharacterTags(character.tags)[0], conversationCount > 0 ? `${conversationCount}回` : null]
    .filter((item): item is string => Boolean(item))
    .join(" ・ ");

export const OuMyScreen = ({
  characters,
  onCreate,
  onSettings,
  onTalk,
  onEdit,
  onMemory,
  onLog,
  onUtage,
}: OuMyScreenProps) => {
  const { data: conversations = [] } = useQuery({
    queryKey: queryKey.conversationList,
    queryFn: listConversations,
  });
  const conversationsCountByCharacter = new Map<string, number>();
  conversations.forEach((conversation) => {
    conversationsCountByCharacter.set(
      conversation.characterId,
      (conversationsCountByCharacter.get(conversation.characterId) ?? 0) + 1,
    );
  });

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "18px 18px 104px" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1
          style={{
            margin: 0,
            fontFamily: OU2.serif,
            fontSize: 24,
            letterSpacing: "0.1em",
            color: OU2.text,
          }}
        >
          マイ
        </h1>
        <button
          type="button"
          onClick={onSettings}
          aria-label="設定"
          style={{
            width: 44,
            height: 44,
            borderRadius: "50%",
            border: `1px solid ${OU2.hairline}`,
            background: OU2.veil,
            color: OU2.lamp,
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
          }}
        >
          <Settings width={18} height={18} />
        </button>
      </header>

      <button
        type="button"
        onClick={() => onCreate()}
        style={{
          width: "100%",
          marginTop: 24,
          padding: 20,
          borderRadius: 22,
          border: `1px solid ${OU2.lamp}`,
          background: `linear-gradient(135deg, rgba(214,169,87,.32), ${OU2.veil})`,
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        <div style={{ color: OU2.lamp, fontSize: 18 }}>✦</div>
        <div
          style={{
            marginTop: 8,
            fontFamily: OU2.serif,
            fontSize: 22,
            color: OU2.text,
            letterSpacing: "0.04em",
          }}
        >
          あたらしい相手をつくる
        </div>
        <p
          style={{
            margin: "10px 0 0",
            fontFamily: OU2.round,
            fontSize: 13,
            lineHeight: 1.7,
            color: OU2.dim,
          }}
        >
          話しながら・シナリオから・こだわって。この世のどこにもいない子を。
        </p>
        <div
          style={{
            marginTop: 12,
            textAlign: "right",
            fontFamily: OU2.round,
            fontSize: 12,
            color: OU2.lamp,
          }}
        >
          つくる →
        </div>
      </button>

      <section style={{ marginTop: 44 }}>
        <div
          style={{
            fontFamily: OU2.round,
            fontSize: 12,
            letterSpacing: "0.18em",
            color: "#b79766",
            marginBottom: 12,
          }}
        >
          つくった子 — {characters.length}人
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          {characters.map((character) => {
            // 認証フェッチ失敗時のフォールバックと avatar 未設定時の表示は同じ頭文字プレースホルダーなので共有する
            const avatarFallback = (
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: "50%",
                  background: OU2.ink,
                  color: OU2.faint,
                  display: "grid",
                  placeItems: "center",
                  fontFamily: OU2.serif,
                  fontSize: 20,
                }}
              >
                {character.name[0]}
              </div>
            );
            return (
              <div
                key={character.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "52px minmax(0, 1fr) auto auto",
                  gap: 10,
                  alignItems: "center",
                  padding: "10px 0",
                  borderBottom: `1px solid ${OU2.hairline}`,
                }}
              >
                {character.avatar ? (
                  <AuthenticatedImage
                    src={character.avatar}
                    alt=""
                    style={{ width: 52, height: 52, borderRadius: "50%", objectFit: "cover" }}
                    fallback={avatarFallback}
                  />
                ) : (
                  avatarFallback
                )}
                <div style={{ minWidth: 0, overflow: "hidden" }}>
                  <div
                    style={{
                      fontFamily: OU2.serif,
                      fontSize: 18,
                      color: OU2.text,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <CharacterName name={character.name} reading={character.nameReading} />
                  </div>
                  {metaLine(character, conversationsCountByCharacter.get(character.id) ?? 0) && (
                    <div
                      style={{
                        marginTop: 3,
                        fontFamily: OU2.round,
                        fontSize: 11,
                        color: OU2.faint,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {metaLine(character, conversationsCountByCharacter.get(character.id) ?? 0)}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onTalk(character.id)}
                  style={{
                    border: `1px solid ${OU2.lampDim}`,
                    borderRadius: 999,
                    background: "transparent",
                    color: OU2.lamp,
                    fontFamily: OU2.round,
                    fontSize: 12,
                    padding: "10px 14px",
                    minHeight: 44,
                    minWidth: 44,
                    cursor: "pointer",
                  }}
                >
                  話す
                </button>
                <button
                  type="button"
                  onClick={() => onEdit(character.id)}
                  aria-label={`${character.name}を編集`}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: "50%",
                    border: `1px solid ${OU2.hairline}`,
                    background: "transparent",
                    color: OU2.dim,
                    display: "grid",
                    placeItems: "center",
                    cursor: "pointer",
                  }}
                >
                  <Pencil width={18} height={18} />
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <section style={{ marginTop: 30 }}>
        <div
          style={{
            fontFamily: OU2.round,
            fontSize: 12,
            letterSpacing: "0.18em",
            color: "#b79766",
            marginBottom: 12,
          }}
        >
          ふたりの記録
        </div>
        <div
          style={{
            border: `1px solid ${OU2.hairline}`,
            borderRadius: 18,
            overflow: "hidden",
            background: OU2.veil,
          }}
        >
          {[
            ["◆", "記憶", onMemory],
            ["≡", "履歴", onLog],
            ["❖", "宴", onUtage],
          ].map(([mark, label, action]) => (
            <button
              key={label as string}
              type="button"
              onClick={action as () => void}
              style={{
                display: "flex",
                alignItems: "center",
                width: "100%",
                gap: 12,
                padding: "14px 16px",
                border: "none",
                borderBottom: label === "宴" ? "none" : `1px solid ${OU2.hairline}`,
                background: "transparent",
                color: OU2.dim,
                fontFamily: OU2.round,
                fontSize: 14,
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <span style={{ color: OU2.lamp }}>{mark as string}</span>
              <span style={{ flex: 1 }}>{label as string}</span>
              <ChevronRight width={18} height={18} />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
};
