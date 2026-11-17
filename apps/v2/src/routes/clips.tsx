// RIT-30 ギャップ（Saylo のクリップフィード）: 作ったショート動画を新しい順に流す（板 Clips）。
// 再生したら /api/clips/:id/play で再生数を1足す（1回だけ・連打は無視）。
import { useRef } from "react";

import { createFileRoute, getRouteApi, Link, useRouter } from "@tanstack/react-router";

import {
  ArrowIcon,
  BottomBar,
  EmptyState,
  ErrorCard,
  Face,
  PlusIcon,
  SubHeader,
} from "../component/make-screen";
import { dayLabel } from "../lib/day-label";
import { listCharacters } from "../server/characters";
import { listClips } from "../server/clips";

import "../component/clip-screen.css";

import type { ClipListItem } from "../server/api-clips";
import type { CharacterListItem } from "../server/characters";

const routeApi = getRouteApi("/clips");

const ClipCard = ({
  clip,
  character,
}: {
  clip: ClipListItem;
  character: CharacterListItem | undefined;
}) => {
  const played = useRef(false);
  const registerPlay = () => {
    if (played.current) return;
    played.current = true;
    void fetch(`/api/clips/${encodeURIComponent(clip.id)}/play`, {
      method: "POST",
    }).catch(() => {});
  };
  const name = character?.name ?? clip.characterName ?? "削除された子";
  return (
    <li className="v2-clip-subject">
      <div className="v2-clip-stage">
        <video
          src={clip.videoUrl}
          controls
          playsInline
          preload="metadata"
          aria-label={`${name}のクリップ`}
          onPlay={registerPlay}
        />
      </div>
      <div className="v2-clip-subject-row">
        <Face id={clip.characterId} name={name} avatar={character?.avatar} />
        <span className="v2-make-row-text">
          <span className="v2-make-row-name">{name}</span>
          {clip.prompt && <span className="v2-make-row-note">{clip.prompt}</span>}
        </span>
        <span className="v2-make-row-date">{dayLabel(clip.createdAt)}</span>
      </div>
    </li>
  );
};

const PendingCard = ({ count }: { count: number }) => (
  <div className="v2-clip-progress-card" role="status">
    <span className="v2-make-row-name">{count} 本をつくっています</span>
    <span className="v2-clip-hint">できあがると、ここに並びます。</span>
  </div>
);

const ClipsPage = () => {
  const { clips, characters } = routeApi.useLoaderData();
  const byId = new Map(characters.map((character) => [character.id, character]));
  const ready = clips.filter((clip) => clip.status === "ok" && clip.videoUrl);
  const pending = clips.filter((clip) => clip.status !== "ok" && clip.status !== "failed");

  if (ready.length === 0 && pending.length === 0) {
    return (
      <main className="v2-make">
        <SubHeader title="クリップ" back="/create" />
        <div className="v2-clip-body">
          <EmptyState
            title="まだ、クリップはありません"
            text={
              <>
                トークで届いた画像を、
                <br />
                短いクリップにできます。
              </>
            }
          >
            <div className="v2-make-gap-8" aria-hidden="true" />
            <Link to="/clips/new" className="v2-make-primary v2-clip-empty-go">
              <span>最初の 1 本をつくる</span>
              <ArrowIcon />
            </Link>
          </EmptyState>
        </div>
      </main>
    );
  }

  return (
    <main className="v2-make has-bottom-bar">
      <SubHeader title="クリップ" back="/create" />
      <div className="v2-clip-body list">
        {pending.length > 0 && <PendingCard count={pending.length} />}
        <ul className="v2-clip-feed">
          {ready.map((clip) => (
            <ClipCard key={clip.id} clip={clip} character={byId.get(clip.characterId)} />
          ))}
        </ul>
      </div>
      <BottomBar>
        <Link to="/clips/new" className="v2-make-primary">
          <PlusIcon />
          <span>クリップをつくる</span>
        </Link>
      </BottomBar>
    </main>
  );
};

const ClipsError = () => {
  const router = useRouter();
  return (
    <main className="v2-make">
      <SubHeader title="クリップ" back="/create" />
      <div className="v2-clip-body">
        <ErrorCard
          message="クリップを読み込めませんでした。"
          onRetry={() => void router.invalidate()}
        />
      </div>
    </main>
  );
};

export const Route = createFileRoute("/clips")({
  loader: async ({ abortController }) => {
    const [clips, characters] = await Promise.all([
      listClips(),
      listCharacters({ signal: abortController.signal }),
    ]);
    return { clips, characters };
  },
  errorComponent: ClipsError,
  component: ClipsPage,
});
