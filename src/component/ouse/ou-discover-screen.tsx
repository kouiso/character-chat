import { useMemo, useState } from "react";

import { useQuery } from "@tanstack/react-query";

import { ScrollArea } from "@/component/ui/scroll-area";
import { listConversations, type Character } from "@/lib/api";
import { availableCategoryTags, characterHasTag } from "@/lib/character-category";
import { visibleCharacterTags } from "@/lib/character-display-tag";
import { queryKey } from "@/lib/query-key";

import { ChatscopeCharacterList } from "./chatscope-conversation-item";
import { OU2 } from "./ouse-tokens";

// さがす（設計 D-1）: 上部検索バーで公式もつくった子も横断。名前・タグ・雰囲気の自由語検索。
// ゼロ件でも行き止まりにせず「その条件でつくる」へ接続する。

interface OuDiscoverScreenProps {
  characters: Character[];
  activeCharacterId: string | null;
  onSelectCharacter: (id: string) => void;
  onAddCharacter?: () => void;
}

type DiscoverFilter = "all" | "official" | "mine" | "talked";

const FILTERS: { key: DiscoverFilter; label: string }[] = [
  { key: "all", label: "すべて" },
  { key: "official", label: "公式" },
  { key: "mine", label: "つくった子" },
  { key: "talked", label: "話したことがある" },
];

const matchesQuery = (character: Character, terms: string[]): boolean => {
  if (terms.length === 0) return true;
  // 内部タグは画面に出ないので、検索でヒットしても根拠が見えず不可解になる。検索対象からも外す
  const haystack = [character.name, character.greeting, ...visibleCharacterTags(character.tags)]
    .join(" ")
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
};

interface FilterChipProps {
  label: string;
  active: boolean;
  onClick: () => void;
  "data-testid"?: string;
}

const FilterChip = ({ label, active, onClick, "data-testid": testId }: FilterChipProps) => (
  <button
    type="button"
    data-testid={testId}
    onClick={onClick}
    aria-pressed={active}
    style={{
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      flex: "0 0 auto",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      maxWidth: "100%",
      minWidth: 44,
      minHeight: 44,
      padding: "7px 13px",
      borderRadius: 15,
      border: `1px solid ${active ? OU2.lampDim : OU2.hairline}`,
      background: active ? "rgba(214,160,84,.2)" : "transparent",
      color: active ? OU2.accent : OU2.faint,
      fontFamily: OU2.round,
      fontSize: 12,
      cursor: "pointer",
    }}
  >
    {label}
  </button>
);

interface CategorySectionProps {
  categoryLabel: string;
  tags: string[];
  activeTag: string | null;
  setActiveTag: (tag: string | null) => void;
}

const CategorySection = ({
  categoryLabel,
  tags,
  activeTag,
  setActiveTag,
}: CategorySectionProps) => (
  <div style={{ borderBottom: `1px solid ${OU2.hairline}` }}>
    <div
      style={{
        padding: "10px 20px 6px",
        fontFamily: OU2.round,
        fontSize: 11.5,
        color: OU2.dim,
        letterSpacing: "0.12em",
      }}
    >
      {categoryLabel}
    </div>
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 7,
        padding: "0 20px 12px",
      }}
    >
      {tags.map((tag) => {
        const active = activeTag === tag;
        return (
          <FilterChip
            key={tag}
            label={tag}
            active={active}
            onClick={() => setActiveTag(active ? null : tag)}
          />
        );
      })}
    </div>
  </div>
);

export const OuDiscoverScreen = ({
  characters,
  activeCharacterId,
  onSelectCharacter,
  onAddCharacter,
}: OuDiscoverScreenProps) => {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<DiscoverFilter>("all");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const { data: conversations = [] } = useQuery({
    queryKey: queryKey.conversationList,
    queryFn: listConversations,
  });

  const talkedIds = useMemo(
    () => new Set(conversations.map((conversation) => conversation.characterId)),
    [conversations],
  );

  const terms = useMemo(
    () =>
      query
        .toLowerCase()
        .split(/\s+/u)
        .map((term) => term.trim())
        .filter(Boolean),
    [query],
  );

  const categoryTagGroups = useMemo(
    () => availableCategoryTags(characters.map((character) => character.tags)),
    [characters],
  );

  const results = useMemo(
    () =>
      characters.filter((character) => {
        if (filter === "official" && !character.isOfficial) return false;
        if (filter === "mine" && character.isOfficial) return false;
        if (filter === "talked" && !talkedIds.has(character.id)) return false;
        if (activeTag && !characterHasTag(character.tags, activeTag)) return false;
        return matchesQuery(character, terms);
      }),
    [characters, filter, terms, talkedIds, activeTag],
  );

  return (
    <div
      className="ou-discover"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        background: OU2.night,
      }}
    >
      <ScrollArea
        className="ou-discover-scroll"
        style={{ flex: 1, minHeight: 0, background: OU2.night }}
      >
        <div>
          {/* 固定ヘッダ: 検索 + 横断フィルタ */}
          <div
            style={{
              position: "sticky",
              top: 0,
              zIndex: 4,
              background: OU2.night,
            }}
          >
            {/* 検索バー（設計 D-1 の入口） */}
            <div
              data-testid="discover-search-dock"
              style={{
                position: "sticky",
                top: 0,
                padding: "14px 20px 10px",
                background: OU2.night,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "0 16px",
                  minHeight: 44,
                  borderRadius: 22,
                  background: "rgba(20,15,13,.7)",
                  border: `1px solid ${query ? OU2.lampDim : OU2.hairline}`,
                }}
              >
                <span style={{ fontSize: 14, color: OU2.lampDim }}>⌕</span>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="名前・タグ・雰囲気で探す"
                  aria-label="キャラクターを検索"
                  style={{
                    flex: 1,
                    minHeight: 44,
                    lineHeight: "44px",
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    fontFamily: OU2.round,
                    fontSize: 13.5,
                    color: OU2.text,
                  }}
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label="検索をクリア"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      minWidth: 44,
                      minHeight: 44,
                      background: "none",
                      border: "none",
                      color: OU2.faint,
                      fontSize: 13,
                      cursor: "pointer",
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {/* 横断フィルタ: 折り返して常に可視 */}
            <div
              data-testid="discover-filter-chips"
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 7,
                padding: "4px 20px 10px",
              }}
            >
              {FILTERS.map(({ key, label }) => (
                <FilterChip
                  key={key}
                  label={label}
                  active={filter === key}
                  onClick={() => setFilter(key)}
                  data-testid={`discover-filter-${key}`}
                />
              ))}
              {/* カテゴリの開閉も同じ折り返し領域に置く。別のコンテナに出しとったせいで、
                  横並びに余りがあっても必ず改行され、チップが 3 段にばらけて見えとった。 */}
              <button
                type="button"
                onClick={() => setCategoriesOpen((v) => !v)}
                aria-expanded={categoriesOpen}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  minHeight: 36,
                  padding: "6px 14px",
                  borderRadius: 18,
                  border: `1px solid ${OU2.hairline}`,
                  background: "transparent",
                  color: OU2.faint,
                  fontFamily: OU2.round,
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                <span>{categoriesOpen ? "▲" : "▼"}</span>
                <span>カテゴリで絞り込む</span>
              </button>
              {activeTag && (
                <button
                  type="button"
                  onClick={() => setActiveTag(null)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    minHeight: 36,
                    padding: "6px 12px",
                    borderRadius: 18,
                    border: `1px solid ${OU2.lampDim}`,
                    background: "rgba(214,160,84,.15)",
                    color: OU2.accent,
                    fontFamily: OU2.round,
                    fontSize: 12,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    maxWidth: "100%",
                    cursor: "pointer",
                  }}
                >
                  <span>{activeTag}</span>
                  <span aria-label="カテゴリ絞り込みを解除">✕</span>
                </button>
              )}
            </div>
          </div>

          {/* カテゴリ絞り込み（#830）。誰も持っていないタグは出さない＝押して0件にならない */}
          {categoriesOpen &&
            categoryTagGroups.map(({ category, tags }) => (
              <CategorySection
                key={category.key}
                categoryLabel={category.label}
                tags={tags}
                activeTag={activeTag}
                setActiveTag={setActiveTag}
              />
            ))}

          <div
            style={{
              padding: "14px 20px 8px",
              fontFamily: OU2.round,
              fontSize: 10.5,
              letterSpacing: "0.18em",
              color: OU2.dim,
            }}
          >
            {results.length}人が見つかりました
          </div>

          {results.length > 0 && (
            <ChatscopeCharacterList
              characters={results}
              activeCharacterId={activeCharacterId}
              onSelectCharacter={onSelectCharacter}
            />
          )}

          {/* ゼロ件でも行き止まりにしない（設計 D-1） */}
          {onAddCharacter && (
            <div style={{ padding: "0 20px 16px" }}>
              <button
                type="button"
                onClick={() => onAddCharacter()}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  width: "100%",
                  marginTop: 16,
                  padding: "15px 17px",
                  borderRadius: 18,
                  border: `1px dashed ${OU2.lampDim}`,
                  background: "rgba(214,160,84,.07)",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <span style={{ fontSize: 17, color: OU2.lamp }}>✦</span>
                <span
                  style={{ fontFamily: OU2.round, fontSize: 12, lineHeight: 1.7, color: OU2.dim }}
                >
                  ぴったりの子がいない？
                  <br />
                  <b style={{ color: OU2.accent }}>
                    {query ? `「${query}」のままつくる →` : "あたらしくつくる →"}
                  </b>
                </span>
              </button>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};
