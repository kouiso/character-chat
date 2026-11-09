// RIT-209: 雑談広場。公開テキストボード（投稿・一覧・本人削除・もっと読む）。
import { useState } from "react";

import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router";

import { deleteBoardPost, loadBoard, postToBoard, type BoardPost } from "../lib/board";
import { listBoardPage } from "../server/board";

const routeApi = getRouteApi("/board");

const BoardPage = () => {
  const initial = routeApi.useLoaderData();
  const [items, setItems] = useState<BoardPost[]>(initial.items);
  const [cursor, setCursor] = useState<string | null>(initial.nextCursor);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = () => {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    void postToBoard(body)
      .then(() => loadBoard())
      .then((page) => {
        setItems(page.items);
        setCursor(page.nextCursor);
        setDraft("");
      })
      .catch((cause) => setError((cause as Error).message))
      .finally(() => setBusy(false));
  };

  const more = () => {
    if (!cursor || busy) return;
    setBusy(true);
    void loadBoard(cursor)
      .then((page) => {
        setItems((prev) => [...prev, ...page.items]);
        setCursor(page.nextCursor);
      })
      .catch((cause) => setError((cause as Error).message))
      .finally(() => setBusy(false));
  };

  const remove = (postId: string) => {
    void deleteBoardPost(postId)
      .then(() => setItems((prev) => prev.filter((post) => post.id !== postId)))
      .catch((cause) => setError((cause as Error).message));
  };

  return (
    <div className="v2-board">
      <h1>雑談広場</h1>
      <Link to="/">キャラクター一覧へ戻る</Link>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <textarea
          value={draft}
          maxLength={500}
          placeholder="いまどうしてる？"
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" disabled={busy || !draft.trim()}>
          投稿する
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      <ul>
        {items.map((post) => (
          <li key={post.id}>
            <p>{post.body}</p>
            <time dateTime={new Date(post.createdAt).toISOString()}>
              {new Date(post.createdAt).toLocaleString()}
            </time>
            {post.mine && (
              <button type="button" onClick={() => remove(post.id)}>
                削除
              </button>
            )}
          </li>
        ))}
      </ul>
      {cursor && (
        <button type="button" disabled={busy} onClick={more}>
          もっと読む
        </button>
      )}
    </div>
  );
};

export const Route = createFileRoute("/board")({
  loader: () => listBoardPage(),
  component: BoardPage,
});
