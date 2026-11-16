// 「覚えた：…」リンク（RIT-92）。直近の返事の下にだけ出る。
// done で記憶があれば1件目を見せ、押すと記憶の画面へ。pending は 3 秒ごとに
// 最大 10 回まで問い直す。none/failed/記憶なし/通信失敗では出さん。
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";

import { fetchLearnedMemories } from "../lib/memories";

const POLL_INTERVAL_MS = 3_000;
const POLL_MAX = 10;

type LearnedMemoryLinkProps = {
  characterId: string;
  conversationId: string;
  turn: number;
};

export const LearnedMemoryLink = ({
  characterId,
  conversationId,
  turn,
}: LearnedMemoryLinkProps) => {
  const [learned, setLearned] = useState<{ id: string; content: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const poll = async (attempt: number) => {
      try {
        const result = await fetchLearnedMemories(characterId, conversationId, turn);
        if (cancelled) return;
        if (result.state === "pending") {
          if (attempt < POLL_MAX) {
            timer = window.setTimeout(() => void poll(attempt + 1), POLL_INTERVAL_MS);
          }
          return;
        }
        if (result.state === "done" && result.memories.length > 0) {
          setLearned(result.memories[0]);
        }
      } catch {
        if (!cancelled && attempt < POLL_MAX) {
          timer = window.setTimeout(() => void poll(attempt + 1), POLL_INTERVAL_MS);
        }
      }
    };
    void poll(1);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [characterId, conversationId, turn]);

  if (!learned) return null;
  return (
    <Link
      className="v2-learned-link"
      to="/chat/$id/memory"
      params={{ id: characterId }}
      search={{ conversationId }}
    >
      <span className="v2-learned-link-text">覚えた：{learned.content}</span>
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
        <path
          d="M6 3l5 5-5 5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </Link>
  );
};
