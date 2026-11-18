// アルバム（板 Album）: 届いた画像とクリップを新しい順に並べる。
// 種類（すべて/画像/4コマ/クリップ）と子（みんな＋先頭3人＋「ほか」シート）で絞る。
import { useMemo, useState } from "react";

import { createFileRoute, getRouteApi, Link, useRouter } from "@tanstack/react-router";

import {
  ChevronIcon,
  EmptyState,
  ErrorCard,
  Face,
  RootHeader,
  Sheet,
} from "../component/make-screen";
import { dayLabel } from "../lib/day-label";
import { listAlbum } from "../server/album";
import { listCharacters } from "../server/characters";

import "../component/album-screen.css";

import type { AlbumItem, AlbumItemKind } from "../server/api-album";
import type { CharacterListItem } from "../server/characters";

const routeApi = getRouteApi("/album");

const KINDS: { value: AlbumItemKind | "all"; label: string }[] = [
  { value: "all", label: "すべて" },
  { value: "image", label: "画像" },
  { value: "comic", label: "4コマ" },
  { value: "clip", label: "クリップ" },
];

const KIND_BADGE: Record<AlbumItemKind, string | null> = {
  image: null,
  comic: "4コマ",
  clip: "クリップ",
};

const KIND_LABEL: Record<AlbumItemKind, string> = {
  image: "画像",
  comic: "4コマ",
  clip: "クリップ",
};

// 板は先頭3人までチップに出し、それ以降は「ほか」のシートへ畳む。
const VISIBLE_CHIPS = 3;

const AlbumTile = ({ item }: { item: AlbumItem }) => {
  const badge = KIND_BADGE[item.kind];
  return (
    <li className="v2-album-cell">
      <a
        href={item.mediaUrl}
        target="_blank"
        rel="noreferrer"
        className="v2-album-tile"
        aria-label={`${item.characterName}の${KIND_LABEL[item.kind]}`}
      >
        {item.mediaKind === "video" ? (
          <video src={item.mediaUrl} playsInline muted preload="metadata" />
        ) : (
          <img src={item.mediaUrl} alt="" loading="lazy" />
        )}
        {badge && <span className="v2-album-badge">{badge}</span>}
      </a>
    </li>
  );
};

// 板は「日付 ・ 子の名前」の見出しで束ねる。同日に別の子が混ざる時は子ごとに分ける。
const groupItems = (items: AlbumItem[]): { label: string; items: AlbumItem[] }[] => {
  const groups = new Map<string, AlbumItem[]>();
  for (const item of items) {
    const key = `${dayLabel(item.createdAt)}\0${item.characterId}`;
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.values()].map((list) => ({
    label: `${dayLabel(list[0].createdAt)} ・ ${list[0].characterName}`,
    items: list,
  }));
};

const KindFilter = ({
  kind,
  onChange,
}: {
  kind: AlbumItemKind | "all";
  onChange: (kind: AlbumItemKind | "all") => void;
}) => {
  const [open, setOpen] = useState(false);
  const selected = KINDS.find((entry) => entry.value === kind) ?? KINDS[0];
  return (
    <div className="v2-album-kind">
      <button
        type="button"
        className="v2-album-kind-button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="v2-album-kind-label">種類</span>
        <span className="v2-album-kind-value">{selected.label}</span>
        <ChevronIcon />
      </button>
      {open && (
        <div role="menu" className="v2-album-kind-menu">
          {KINDS.map((entry) => (
            <button
              key={entry.value}
              type="button"
              role="menuitemradio"
              aria-checked={kind === entry.value}
              className={`v2-album-kind-option${kind === entry.value ? " on" : ""}`}
              onClick={() => {
                onChange(entry.value);
                setOpen(false);
              }}
            >
              {entry.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const ChipBar = ({
  characters,
  characterId,
  onChange,
  onOpenOthers,
}: {
  characters: CharacterListItem[];
  characterId: string | null;
  onChange: (id: string | null) => void;
  onOpenOthers: () => void;
}) => {
  const visible = characters.slice(0, VISIBLE_CHIPS);
  const other = characters.find(
    (entry) => entry.id === characterId && !visible.some((v) => v.id === entry.id),
  );
  const chip = (id: string | null, name: string, on = characterId === id, pick = onChange) => (
    <button
      key={id ?? "all"}
      type="button"
      className={`v2-album-chip${on ? " on" : ""}`}
      aria-pressed={on}
      onClick={() => pick(id)}
    >
      {name}
    </button>
  );
  return (
    <div className="v2-album-chips" role="group" aria-label="子で絞り込む">
      {chip(null, "みんな")}
      {visible.map((entry) => chip(entry.id, entry.name))}
      {characters.length > VISIBLE_CHIPS &&
        chip(other?.id ?? "__others__", other ? other.name : "ほか", other !== undefined, () =>
          onOpenOthers(),
        )}
    </div>
  );
};

const OthersSheet = ({
  characters,
  characterId,
  onPick,
}: {
  characters: CharacterListItem[];
  characterId: string | null;
  onPick: (id: string | null) => void;
}) => (
  <Sheet title="子で絞り込む" onClose={() => onPick(characterId)}>
    <ul className="v2-album-others">
      <li>
        <button
          type="button"
          className={`v2-album-other${characterId === null ? " on" : ""}`}
          onClick={() => onPick(null)}
        >
          <span className="v2-album-other-name">みんな</span>
        </button>
      </li>
      {characters.map((entry) => (
        <li key={entry.id}>
          <button
            type="button"
            className={`v2-album-other${characterId === entry.id ? " on" : ""}`}
            onClick={() => onPick(entry.id)}
          >
            <Face id={entry.id} name={entry.name} avatar={entry.avatar} />
            <span className="v2-album-other-name">{entry.name}</span>
          </button>
        </li>
      ))}
    </ul>
  </Sheet>
);

const AlbumBody = ({
  items,
  filtered,
  selectedCharacter,
  selectedKind,
  onReset,
}: {
  items: AlbumItem[];
  filtered: AlbumItem[];
  selectedCharacter: CharacterListItem | null;
  selectedKind: (typeof KINDS)[number];
  onReset: () => void;
}) => {
  if (items.length === 0) {
    return (
      <div className="v2-album-body">
        <EmptyState
          title="まだ、なにも届いていません"
          text={
            <>
              会話の中で画像をもらうと、
              <br />
              ここに並びます。
            </>
          }
        >
          <Link to="/catalog" className="v2-make-primary v2-album-empty-go">
            <span>出会うへ</span>
          </Link>
        </EmptyState>
      </div>
    );
  }
  if (filtered.length === 0) {
    // 板の文型: 「ひなたのクリップは、まだありません」。子だけの絞り込みは「画像」を名詞にする。
    const subject = selectedCharacter
      ? `${selectedCharacter.name}の${selectedKind.value === "all" ? "画像" : selectedKind.label}`
      : selectedKind.label;
    return (
      <div className="v2-album-body">
        <EmptyState
          title={`${subject}は、まだありません`}
          text="画像を開くと、クリップにできます。"
        >
          <button type="button" className="v2-make-surface-button" onClick={onReset}>
            <span>絞り込みを外す</span>
          </button>
        </EmptyState>
      </div>
    );
  }
  return (
    <div className="v2-album-body">
      {groupItems(filtered).map((group) => (
        <section key={`${group.label}-${group.items[0].id}`} className="v2-album-section">
          <h2 className="v2-album-date">{group.label}</h2>
          <ul className="v2-album-grid">
            {group.items.map((item) => (
              <AlbumTile key={item.id} item={item} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
};

const AlbumPage = () => {
  const { items, characters } = routeApi.useLoaderData();
  const [kind, setKind] = useState<AlbumItemKind | "all">("all");
  const [characterId, setCharacterId] = useState<string | null>(null);
  const [othersOpen, setOthersOpen] = useState(false);

  const filtered = useMemo(
    () =>
      items.filter(
        (item) =>
          (kind === "all" || item.kind === kind) &&
          (characterId === null || item.characterId === characterId),
      ),
    [items, kind, characterId],
  );
  const selectedKind = KINDS.find((entry) => entry.value === kind) ?? KINDS[0];
  const selectedCharacter = characters.find((entry) => entry.id === characterId) ?? null;

  return (
    <main className="v2-make has-bottom-bar">
      <header className="v2-album-head">
        <RootHeader title="アルバム" />
        <KindFilter kind={kind} onChange={setKind} />
      </header>
      <ChipBar
        characters={characters}
        characterId={characterId}
        onChange={setCharacterId}
        onOpenOthers={() => setOthersOpen(true)}
      />
      <AlbumBody
        items={items}
        filtered={filtered}
        selectedCharacter={selectedCharacter}
        selectedKind={selectedKind}
        onReset={() => {
          setKind("all");
          setCharacterId(null);
        }}
      />
      {othersOpen && (
        <OthersSheet
          characters={characters}
          characterId={characterId}
          onPick={(id) => {
            setCharacterId(id);
            setOthersOpen(false);
          }}
        />
      )}
    </main>
  );
};

const AlbumError = () => {
  const router = useRouter();
  return (
    <main className="v2-make">
      <RootHeader title="アルバム" />
      <div className="v2-album-body">
        <ErrorCard
          message="アルバムを読み込めませんでした。"
          onRetry={() => void router.invalidate()}
        />
      </div>
    </main>
  );
};

export const Route = createFileRoute("/album")({
  loader: async ({ abortController }) => {
    const [items, characters] = await Promise.all([
      listAlbum(),
      listCharacters({ signal: abortController.signal }),
    ]);
    return { items, characters };
  },
  errorComponent: AlbumError,
  component: AlbumPage,
});
