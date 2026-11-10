// RIT-30 ギャップ（Saylo のクリップフィード）: 作ったショート動画を新しい順に流す。
// 再生したら /api/clips/:id/play で再生数を1足す（1回だけ・連打は無視）。
import { useRef, useState } from "react";

import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router";

import { listClips } from "../server/api-clips";

import type { ClipListItem } from "../server/api-clips";

const routeApi = getRouteApi("/clips");

const ClipCard = ({ clip }: { clip: ClipListItem }) => {
  const played = useRef(false);
  const [plays, setPlays] = useState(clip.playCount);
  const registerPlay = () => {
    if (played.current) return;
    played.current = true;
    void fetch(`/api/clips/${encodeURIComponent(clip.id)}/play`, { method: "POST" })
      .then(async (res) => {
        if (!res.ok) throw new Error("play failed");
        return (await res.json()) as { playCount?: number };
      })
      .then((body) => {
        if (typeof body.playCount === "number") setPlays(body.playCount);
      })
      .catch(() => {});
  };
  return (
    <li className="v2-clip">
      <video
        className="v2-clip-video"
        src={clip.videoUrl}
        controls
        playsInline
        preload="metadata"
        onPlay={registerPlay}
      />
      <div className="v2-clip-meta">
        <Link to="/chat/$id" params={{ id: clip.characterId }}>
          {clip.characterName}
        </Link>
        <span className="v2-play-count">▶ {plays}</span>
      </div>
    </li>
  );
};

const ClipsPage = () => {
  const { clips } = routeApi.useLoaderData();
  const ready = clips.filter((clip) => clip.status === "ok");
  const pending = clips.filter((clip) => clip.status !== "ok" && clip.status !== "failed");
  return (
    <div className="v2-clips">
      <header className="v2-page-head">
        <h1>クリップ</h1>
        <nav>
          <Link to="/create">クリップを作る</Link>
          <Link to="/">キャラ一覧へ</Link>
        </nav>
      </header>
      {pending.length > 0 && <p className="v2-clip-pending">{pending.length}件を生成中…</p>}
      {ready.length === 0 ? (
        <p>
          まだクリップがありません。<Link to="/create">最初の1本を作る</Link>
        </p>
      ) : (
        <ul className="v2-clip-list">
          {ready.map((clip) => (
            <ClipCard key={clip.id} clip={clip} />
          ))}
        </ul>
      )}
    </div>
  );
};

export const Route = createFileRoute("/clips")({
  loader: async () => ({ clips: await listClips() }),
  component: ClipsPage,
});
