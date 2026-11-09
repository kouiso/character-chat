// ストーリー一覧＋新規作成（RIT-214）。キャラ選択は loader の所有キャラ一覧から。
import { useState } from "react";

import { createFileRoute, getRouteApi, Link, useNavigate } from "@tanstack/react-router";

import { createStory } from "../../lib/stories";
import { listCharacters } from "../../server/characters";
import { listStories } from "../../server/stories";

const routeApi = getRouteApi("/stories/");

const StoriesPage = () => {
  const { characters, stories } = routeApi.useLoaderData();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [characterId, setCharacterId] = useState(characters[0]?.id ?? "");
  const [busy, setBusy] = useState(false);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!characterId || !title.trim()) return;
    setBusy(true);
    try {
      const { id } = await createStory({ characterId, title: title.trim() });
      void navigate({ to: "/stories/$id", params: { id } });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="v2-list v2-stories">
      <h1>ストーリー</h1>
      <Link to="/">キャラクター一覧へ</Link>
      <form onSubmit={(e) => void create(e)} className="v2-story-create">
        <select value={characterId} onChange={(e) => setCharacterId(e.target.value)}>
          {characters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="ストーリータイトル"
          maxLength={120}
        />
        <button type="submit" disabled={busy || !characterId || !title.trim()}>
          作成
        </button>
      </form>
      {stories.length === 0 ? (
        <p>まだストーリーがありません。</p>
      ) : (
        <ul>
          {stories.map((s) => (
            <li key={s.id}>
              <Link to="/stories/$id" params={{ id: s.id }}>
                {s.title}
              </Link>
              <span className="v2-story-meta">
                {s.characterName ?? "キャラ不明"}・{s.chapterCount}章
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export const Route = createFileRoute("/stories/")({
  loader: async ({ abortController }) => {
    const signal = abortController.signal;
    const [characters, stories] = await Promise.all([listCharacters({ signal }), listStories()]);
    return { characters, stories };
  },
  component: StoriesPage,
});
