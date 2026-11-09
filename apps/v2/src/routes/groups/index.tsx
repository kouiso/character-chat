// パーティモード: 場一覧＋作成（RIT-216）。2人以上のキャラ選択が要る。
import { useState } from "react";

import { createFileRoute, getRouteApi, Link, useNavigate } from "@tanstack/react-router";

import { createGroup } from "../../lib/groups";
import { listCharacters } from "../../server/characters";
import { listUserGroups } from "../../server/groups";

const routeApi = getRouteApi("/groups/");

const GroupsPage = () => {
  const { characters, groups } = routeApi.useLoaderData();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const names = new Map(characters.map((c) => [c.id, c.name]));

  const toggle = (id: string) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 8 ? [...prev, id] : prev,
    );

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (selected.length < 2 || !title.trim()) return;
    setBusy(true);
    try {
      const { id } = await createGroup({ title: title.trim(), characterIds: selected });
      void navigate({ to: "/groups/$id", params: { id } });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="v2-list v2-groups">
      <h1>パーティモード</h1>
      <Link to="/">キャラクター一覧へ</Link>
      <form onSubmit={(e) => void create(e)} className="v2-group-create">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="場の名前"
          maxLength={80}
        />
        <fieldset>
          <legend>参加者（2〜{Math.min(8, characters.length)}人）</legend>
          {characters.map((c) => (
            <label key={c.id} className="v2-group-member-option">
              <input
                type="checkbox"
                checked={selected.includes(c.id)}
                onChange={() => toggle(c.id)}
              />
              {c.name}
            </label>
          ))}
        </fieldset>
        <button type="submit" disabled={busy || selected.length < 2 || !title.trim()}>
          作成
        </button>
      </form>
      {groups.length === 0 ? (
        <p>まだ場がありません。</p>
      ) : (
        <ul>
          {groups.map((g) => (
            <li key={g.id}>
              <Link to="/groups/$id" params={{ id: g.id }}>
                {g.title}
              </Link>
              <span className="v2-story-meta">
                {g.memberIds.map((id) => names.get(id) ?? id).join("・")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export const Route = createFileRoute("/groups/")({
  loader: async ({ abortController }) => {
    const signal = abortController.signal;
    const [characters, groups] = await Promise.all([listCharacters({ signal }), listUserGroups()]);
    return { characters, groups };
  },
  component: GroupsPage,
});
