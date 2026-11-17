// ストーリー一覧＋新規作成（RIT-214・板 Stories）。キャラ選択は loader の所有キャラ一覧から。
import { useState } from "react";

import { createFileRoute, getRouteApi, Link, useNavigate, useRouter } from "@tanstack/react-router";

import {
  CheckIcon,
  EmptyState,
  ErrorCard,
  Face,
  PlusIcon,
  Sheet,
  SubHeader,
} from "../../component/make-screen";
import { dayLabel } from "../../lib/day-label";
import { createStory } from "../../lib/stories";
import { listCharacters } from "../../server/characters";
import { listStories } from "../../server/stories";

import type { CharacterListItem } from "../../server/characters";

const routeApi = getRouteApi("/stories/");

const NewStorySheet = ({
  characters,
  onClose,
}: {
  characters: CharacterListItem[];
  onClose: () => void;
}) => {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [characterId, setCharacterId] = useState(characters[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const ready = Boolean(characterId && title.trim());

  const create = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const { id } = await createStory({ characterId, title: title.trim() });
      void navigate({ to: "/stories/$id", params: { id } });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title="新しいストーリー" onClose={onClose}>
      <form
        className="v2-make-field"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <div className="v2-make-label">登場する子</div>
        <div
          role="radiogroup"
          aria-label="登場する子"
          className="v2-make-choice-card v2-make-choices-scroll"
        >
          {characters.map((character) => {
            const selected = character.id === characterId;
            return (
              <button
                key={character.id}
                type="button"
                role="radio"
                aria-checked={selected}
                className="v2-make-choice"
                onClick={() => setCharacterId(character.id)}
              >
                <Face id={character.id} name={character.name} avatar={character.avatar} />
                <span className="v2-make-choice-name">{character.name}</span>
                {selected && (
                  <span className="v2-make-choice-check">
                    <CheckIcon />
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="v2-make-gap-8" aria-hidden="true" />
        <label htmlFor="story-title" className="v2-make-label">
          タイトル
        </label>
        <input
          id="story-title"
          className="v2-make-input"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={120}
        />
        {failed && (
          <ErrorCard
            message="ストーリーをつくれませんでした。"
            note="入れた内容は残っています。"
            onRetry={() => void create()}
          />
        )}
        <div className="v2-make-gap-16" aria-hidden="true" />
        {!ready && <p className="v2-make-note">タイトルを入れると、つくれます。</p>}
        <button type="submit" className="v2-make-primary" disabled={!ready || busy}>
          <span>{busy ? "つくっています" : "つくる"}</span>
        </button>
      </form>
    </Sheet>
  );
};

const StoriesPage = () => {
  const { characters, stories } = routeApi.useLoaderData();
  const [sheetOpen, setSheetOpen] = useState(false);
  const byId = new Map(characters.map((character) => [character.id, character]));

  return (
    <main className="v2-make">
      <SubHeader title="ストーリー" back="/create" />
      <div className="v2-make-body">
        {stories.length === 0 ? (
          <EmptyState
            title="まだ、ストーリーはありません"
            text={
              <>
                登場する子をひとり選んで、
                <br />
                章ごとに書いていけます。
              </>
            }
          >
            <div className="v2-make-gap-8" aria-hidden="true" />
            <button
              type="button"
              className="v2-make-primary v2-make-wide"
              onClick={() => setSheetOpen(true)}
              disabled={characters.length === 0}
            >
              <PlusIcon />
              <span>ストーリーをつくる</span>
            </button>
          </EmptyState>
        ) : (
          <>
            <div className="v2-make-gap-8" aria-hidden="true" />
            <button
              type="button"
              className="v2-make-primary"
              onClick={() => setSheetOpen(true)}
              disabled={characters.length === 0}
            >
              <PlusIcon />
              <span>ストーリーをつくる</span>
            </button>
            <div className="v2-make-gap-24" aria-hidden="true" />
            <ul className="v2-make-list">
              {stories.map((story) => {
                const name = story.characterName ?? "削除された子";
                const face = (
                  <>
                    <Face
                      id={story.characterId}
                      name={name}
                      avatar={byId.get(story.characterId)?.avatar}
                    />
                    <span className="v2-make-row-text">
                      <span className="v2-make-row-name">{story.title}</span>
                      <span className="v2-make-row-note">
                        {name}・{story.chapterCount} 章
                      </span>
                    </span>
                    <span className="v2-make-row-date">{dayLabel(story.updatedAt)}</span>
                  </>
                );
                // 章が無いうちは読む物が無いので編集へ送る（板 Stories「まだ章がありません」）
                return (
                  <li key={story.id} className="v2-make-row">
                    {story.chapterCount > 0 ? (
                      <Link
                        to="/stories/$id/read"
                        params={{ id: story.id }}
                        aria-label={`「${story.title}」を読む`}
                        className="v2-make-row-link"
                      >
                        {face}
                      </Link>
                    ) : (
                      <Link
                        to="/stories/$id"
                        params={{ id: story.id }}
                        aria-label={`「${story.title}」を編集（まだ章がありません）`}
                        className="v2-make-row-link"
                      >
                        {face}
                      </Link>
                    )}
                    <Link
                      to="/stories/$id"
                      params={{ id: story.id }}
                      aria-label={`「${story.title}」を編集`}
                      className="v2-make-row-action"
                    >
                      編集
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
      {sheetOpen && <NewStorySheet characters={characters} onClose={() => setSheetOpen(false)} />}
    </main>
  );
};

const StoriesError = () => {
  const router = useRouter();
  return (
    <main className="v2-make">
      <SubHeader title="ストーリー" back="/create" />
      <div className="v2-make-body">
        <ErrorCard
          message="ストーリーを読み込めませんでした。"
          onRetry={() => void router.invalidate()}
        />
      </div>
    </main>
  );
};

export const Route = createFileRoute("/stories/")({
  loader: async ({ abortController }) => {
    const signal = abortController.signal;
    const [characters, stories] = await Promise.all([listCharacters({ signal }), listStories()]);
    return { characters, stories };
  },
  errorComponent: StoriesError,
  component: StoriesPage,
});
