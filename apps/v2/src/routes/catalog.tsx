// RIT-206: 公開カタログ。公開キャラの一覧→フォーク→自分のライブラリへ。
import { useState } from "react";

import { createFileRoute, getRouteApi, Link, useNavigate } from "@tanstack/react-router";

import { forkCatalogItem, loadCatalog, type CatalogItem } from "../lib/catalog";

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
      <strong>{item.name}</strong>
      {item.summary && <p>{item.summary}</p>}
      <p>{item.greeting}</p>
      <button type="button" disabled={busy} onClick={fork}>
        {busy ? "フォーク中…" : "自分のライブラリへコピー"}
      </button>
      {error && <p role="alert">{error}</p>}
    </li>
  );
};

const CatalogPage = () => {
  const { items } = routeApi.useLoaderData();
  return (
    <div className="v2-catalog">
      <h1>公開キャラクター</h1>
      <Link to="/">キャラクター一覧へ戻る</Link>
      {items.length === 0 ? (
        <p>公開キャラクターはまだいません。</p>
      ) : (
        <ul>
          {items.map((item) => (
            <CatalogCard key={item.characterId} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
};

export const Route = createFileRoute("/catalog")({
  loader: async ({ abortController }) => ({
    items: await loadCatalog(abortController.signal),
  }),
  component: CatalogPage,
});
