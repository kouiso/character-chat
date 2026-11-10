// RIT-206: 公開カタログ。公開キャラの一覧→フォーク→自分のライブラリへ。
import { useState } from "react";

import { createFileRoute, getRouteApi, Link, useNavigate } from "@tanstack/react-router";

import { ReactionPanel } from "../component/reaction-panel";
import { TipPanel } from "../component/tip-panel";
import { forkCatalogItem } from "../lib/catalog";
import { listCatalogItems } from "../server/catalog";

import type { CatalogItem } from "../server/api-publish";

const routeApi = getRouteApi("/catalog");

const CatalogCard = ({ item }: { item: CatalogItem }) => {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fork = () => {
    if (busy) return;
    setBusy(true);
    void forkCatalogItem(item.characterId)
      .then((created) => void navigate({ to: "/chat/$id", params: { id: created.id } }))
      .catch((cause) => {
        setError((cause as Error).message);
        setBusy(false);
      });
  };

  return (
    <li>
      <span className="v2-avatar" aria-hidden>
        {item.name.slice(0, 1)}
        {item.avatar && (
          <img
            src={`/avatars/${encodeURIComponent(item.avatar)}`}
            alt=""
            loading="lazy"
            onError={(e) => e.currentTarget.remove()}
          />
        )}
      </span>
      <strong>{item.name}</strong>
      {item.playCount > 0 && <span className="v2-play-count">▶ {item.playCount}</span>}
      {item.summary && <p>{item.summary}</p>}
      <p>{item.greeting}</p>
      <button type="button" disabled={busy} onClick={fork}>
        {busy ? "フォーク中…" : "自分のライブラリへコピー"}
      </button>
      <ReactionPanel characterId={item.characterId} />
      <TipPanel characterId={item.characterId} />
      {error && <p role="alert">{error}</p>}
    </li>
  );
};

const CatalogPage = () => {
  const { items } = routeApi.useLoaderData();
  // RIT-30 ギャップ（Saylo の検索バー）: 名前・紹介・あいさつのどれかに引っかかれば出す。
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? items.filter((item) =>
        [item.name, item.summary ?? "", item.greeting].join("\n").toLowerCase().includes(needle),
      )
    : items;

  return (
    <div className="v2-catalog">
      <h1>公開キャラクター</h1>
      <Link to="/">キャラクター一覧へ戻る</Link>
      {items.length === 0 ? (
        <p>公開キャラクターはまだいません。</p>
      ) : (
        <>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="名前・紹介で検索"
            aria-label="公開キャラ検索"
          />
          <ul>
            {filtered.map((item) => (
              <CatalogCard key={item.characterId} item={item} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
};

export const Route = createFileRoute("/catalog")({
  loader: async () => ({ items: await listCatalogItems() }),
  component: CatalogPage,
});
