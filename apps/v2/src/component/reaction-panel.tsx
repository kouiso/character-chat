// RIT-207: 公開キャラカードのリアクション群（いいね・フォロー・コメント）。
import { useCallback, useEffect, useState } from "react";

import {
  deleteComment,
  loadComments,
  loadReactions,
  postComment,
  toggleFollow,
  toggleLike,
  type CatalogComment,
  type Reactions,
} from "../lib/reactions";

export const ReactionPanel = ({ characterId }: { characterId: string }) => {
  const [reactions, setReactions] = useState<Reactions | null>(null);
  const [comments, setComments] = useState<CatalogComment[] | null>(null);
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    void loadReactions(characterId, abort.signal)
      .then(setReactions)
      .catch(() => setReactions(null));
    return () => abort.abort();
  }, [characterId]);

  const run = useCallback((action: () => Promise<void>) => {
    setError(null);
    void action().catch((cause) => setError((cause as Error).message));
  }, []);

  const like = () =>
    run(async () => {
      const liked = await toggleLike(characterId);
      setReactions((prev) =>
        prev ? { ...prev, liked, likeCount: prev.likeCount + (liked ? 1 : -1) } : prev,
      );
    });

  const follow = (kind: "character" | "creator") =>
    run(async () => {
      const following = await toggleFollow(characterId, kind);
      setReactions((prev) =>
        prev
          ? kind === "character"
            ? { ...prev, followedCharacter: following }
            : { ...prev, followedCreator: following }
          : prev,
      );
    });

  const toggleComments = () => {
    const next = !open;
    setOpen(next);
    if (next && comments === null) {
      void loadComments(characterId)
        .then(setComments)
        .catch((cause) => setError((cause as Error).message));
    }
  };

  const submit = () => {
    const body = draft.trim();
    if (!body) return;
    run(async () => {
      await postComment(characterId, body);
      setDraft("");
      const items = await loadComments(characterId);
      setComments(items);
      setReactions((prev) => (prev ? { ...prev, commentCount: items.length } : prev));
    });
  };

  const remove = (commentId: string) =>
    run(async () => {
      await deleteComment(characterId, commentId);
      const items = await loadComments(characterId);
      setComments(items);
      setReactions((prev) => (prev ? { ...prev, commentCount: items.length } : prev));
    });

  if (!reactions) return null;
  return (
    <section className="v2-reactions">
      <button type="button" aria-pressed={reactions.liked} onClick={like}>
        {reactions.liked ? "いいね済み" : "いいね"}（{reactions.likeCount}）
      </button>
      <button
        type="button"
        aria-pressed={reactions.followedCharacter}
        onClick={() => follow("character")}
      >
        {reactions.followedCharacter ? "キャラのフォロー中" : "キャラをフォロー"}
      </button>
      <button
        type="button"
        aria-pressed={reactions.followedCreator}
        onClick={() => follow("creator")}
      >
        {reactions.followedCreator ? "作者のフォロー中" : "作者をフォロー"}
      </button>
      <button type="button" aria-expanded={open} onClick={toggleComments}>
        コメント（{reactions.commentCount}）
      </button>
      {error && <p role="alert">{error}</p>}
      {open && (
        <div className="v2-comments">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <input
              value={draft}
              maxLength={500}
              placeholder="コメントを書く"
              onChange={(event) => setDraft(event.target.value)}
            />
            <button type="submit" disabled={!draft.trim()}>
              投稿
            </button>
          </form>
          <ul>
            {(comments ?? []).map((comment) => (
              <li key={comment.id}>
                <p>{comment.body}</p>
                {comment.mine && (
                  <button type="button" onClick={() => remove(comment.id)}>
                    削除
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};
