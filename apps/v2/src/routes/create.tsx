// 下タブ「つくる」の根（板 Create）。新しい子をつくる入口と、ほかにつくる物、つくった物の一覧。
// クリップの生成そのものは /clips/new（板 ClipCreate）に置く。
import { useEffect, useState } from "react";

import { createFileRoute, getRouteApi, Link, useRouter } from "@tanstack/react-router";

import {
  ArrowIcon,
  ChevronIcon,
  EmptyState,
  ErrorCard,
  Face,
  MoreLink,
  PencilIcon,
  RootHeader,
  SectionHead,
  SkeletonRows,
} from "../component/make-screen";
import { characterDraftKey, readCharacterDraft } from "../lib/character-draft";
import { dayLabel } from "../lib/day-label";
import { readCharacterEditorIdentity } from "../server/character-editor-identity";
import { listCharacters } from "../server/characters";
import { listClips } from "../server/clips";
import { listUserGroups } from "../server/groups";
import { listStories } from "../server/stories";

import type { CharacterListItem } from "../server/characters";

const routeApi = getRouteApi("/create");

// 板の「ふだん」と同じ数だけ見せ、残りは各一覧へ送る
const SHOWN = { characters: 4, stories: 2, clips: 3, groups: 2 } as const;

const OTHER_MAKES = [
  {
    to: "/stories",
    name: "ストーリー",
    note: "章を書いて、挿絵や 4 コマを添えます。",
  },
  {
    to: "/clips/new",
    name: "クリップ",
    note: "届いた画像を、短いクリップにします。",
  },
  {
    to: "/groups",
    name: "グループ",
    note: "何人かをいっしょに呼んで話します。",
  },
] as const;

// 書きかけの新しい子は端末の下書きにだけある（character-form が保存する）
const useNewCharacterDraft = (ownerUserId: string) => {
  const [draftName, setDraftName] = useState<string | null>(null);
  useEffect(() => {
    const draft = readCharacterDraft(characterDraftKey(ownerUserId));
    setDraftName(draft ? draft.content.name.trim() : null);
  }, [ownerUserId]);
  return draftName;
};

const NewCharacterCard = () => (
  <div className="v2-make-card">
    <div className="v2-make-card-title">新しい子をつくる</div>
    <div className="v2-make-card-text">ひとことで、あとはおまかせ。</div>
    <div className="v2-make-gap-16" aria-hidden="true" />
    <Link to="/characters/new" className="v2-make-primary">
      <span>つくる</span>
      <ArrowIcon />
    </Link>
  </div>
);

const DraftRow = ({ name }: { name: string }) => (
  <>
    <div className="v2-make-gap-12" aria-hidden="true" />
    <Link
      to="/characters/new"
      aria-label="つくりかけをつづきからつくる"
      className="v2-make-press-row"
    >
      <span className="v2-make-press-row-icon">
        <PencilIcon />
      </span>
      <span className="v2-make-row-text">
        <span className="v2-make-row-name">つくりかけ</span>
        <span className="v2-make-row-note">{name ? `こだわって・${name}` : "こだわって"}</span>
      </span>
      <span className="v2-make-press-row-go">つづきから</span>
      <ChevronIcon />
    </Link>
  </>
);

const OtherMakes = () => (
  <>
    <SectionHead title="ほかにつくる" />
    <ul className="v2-make-list">
      {OTHER_MAKES.map((item) => (
        <li key={item.to} className="v2-make-row">
          <Link to={item.to} className="v2-make-row-link">
            <span className="v2-make-row-text">
              <span className="v2-make-row-name">{item.name}</span>
              <span className="v2-make-row-note">{item.note}</span>
            </span>
            <ChevronIcon />
          </Link>
        </li>
      ))}
    </ul>
  </>
);

const OwnCharacters = ({ characters }: { characters: CharacterListItem[] }) => (
  <>
    <SectionHead title="つくった子" level={3}>
      <MoreLink label="マイで見る" ariaLabel="つくった子をマイで見る" to="/my" />
    </SectionHead>
    <ul className="v2-make-list">
      {characters.slice(0, SHOWN.characters).map((character) => (
        <li key={character.id} className="v2-make-row">
          <Link
            to="/chat/$id"
            params={{ id: character.id }}
            aria-label={`${character.name}と話す`}
            className="v2-make-row-link"
          >
            <Face id={character.id} name={character.name} avatar={character.avatar} />
            <span className="v2-make-row-text">
              <span className="v2-make-row-name">{character.name}</span>
            </span>
          </Link>
          <Link
            to="/characters/$id"
            params={{ id: character.id }}
            aria-label={`${character.name}を編集`}
            className="v2-make-row-action"
          >
            編集
          </Link>
        </li>
      ))}
    </ul>
  </>
);

type MadeLists = {
  characters: CharacterListItem[];
  stories: Awaited<ReturnType<typeof listStories>>;
  clips: Awaited<ReturnType<typeof listClips>>;
  groups: Awaited<ReturnType<typeof listUserGroups>>;
};

const MadeThings = ({ characters, stories, clips, groups }: MadeLists) => {
  const own = characters.filter((character) => character.canEdit);
  const byId = new Map(characters.map((character) => [character.id, character]));
  const readyClips = clips.filter((clip) => clip.status === "ok" && clip.videoUrl);
  const isEmpty =
    own.length === 0 && stories.length === 0 && readyClips.length === 0 && groups.length === 0;

  if (isEmpty) {
    return (
      <EmptyState
        title="まだ、つくったものはありません"
        text={
          <>
            つくった子やストーリーが、
            <br />
            ここに並びます。
          </>
        }
      />
    );
  }

  return (
    <>
      {own.length > 0 && <OwnCharacters characters={own} />}
      {stories.length > 0 && (
        <>
          <div className="v2-make-gap-8" aria-hidden="true" />
          <SectionHead title="ストーリー" level={3}>
            <MoreLink label="すべて見る" ariaLabel="ストーリーをすべて見る" to="/stories" />
          </SectionHead>
          <ul className="v2-make-list">
            {stories.slice(0, SHOWN.stories).map((story) => {
              const character = byId.get(story.characterId);
              const characterName = story.characterName ?? "削除された子";
              return (
                <li key={story.id} className="v2-make-row">
                  <Link
                    to="/stories/$id"
                    params={{ id: story.id }}
                    aria-label={`ストーリー ${story.title} を開く`}
                    className="v2-make-row-link"
                  >
                    <Face id={story.characterId} name={characterName} avatar={character?.avatar} />
                    <span className="v2-make-row-text">
                      <span className="v2-make-row-name">{story.title}</span>
                      <span className="v2-make-row-note">
                        {characterName}・{story.chapterCount} 章
                      </span>
                    </span>
                    <span className="v2-make-row-date">{dayLabel(story.updatedAt)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {readyClips.length > 0 && (
        <>
          <div className="v2-make-gap-8" aria-hidden="true" />
          <SectionHead title="クリップ" level={3}>
            <MoreLink label="すべて見る" ariaLabel="クリップをすべて見る" to="/clips" />
          </SectionHead>
          <ul className="v2-make-tiles">
            {readyClips.slice(0, SHOWN.clips).map((clip) => (
              <li key={clip.id}>
                <Link
                  to="/clips"
                  aria-label={`${clip.characterName}のクリップを再生`}
                  className="v2-make-tile"
                >
                  <span className="v2-make-tile-frame">
                    <video src={`${clip.videoUrl}#t=0.1`} muted playsInline preload="metadata" />
                  </span>
                  <span className="v2-make-tile-text">
                    <span className="v2-make-row-name">{clip.characterName}</span>
                    <span className="v2-make-row-note">{dayLabel(clip.createdAt)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      {groups.length > 0 && (
        <>
          <div className="v2-make-gap-8" aria-hidden="true" />
          <SectionHead title="グループ" level={3}>
            <MoreLink label="すべて見る" ariaLabel="グループをすべて見る" to="/groups" />
          </SectionHead>
          <ul className="v2-make-list">
            {groups.slice(0, SHOWN.groups).map((group) => {
              const lead = byId.get(group.memberIds[0] ?? "");
              const names = group.memberIds
                .map((id) => byId.get(id)?.name)
                .filter((name): name is string => Boolean(name));
              return (
                <li key={group.id} className="v2-make-row">
                  <Link
                    to="/groups/$id"
                    params={{ id: group.id }}
                    aria-label={`グループ ${group.title} を開く`}
                    className="v2-make-row-link"
                  >
                    <Face
                      id={lead?.id ?? group.id}
                      name={lead?.name ?? group.title}
                      avatar={lead?.avatar}
                    />
                    <span className="v2-make-row-text">
                      <span className="v2-make-row-name">{group.title}</span>
                      <span className="v2-make-row-note">{names.join("・")}</span>
                    </span>
                    <span className="v2-make-row-date">{dayLabel(group.createdAt)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
};

const CreateFrame = ({
  draftName,
  children,
}: {
  draftName: string | null;
  children: React.ReactNode;
}) => (
  <main className="v2-make">
    <RootHeader title="つくる" />
    <div className="v2-make-body">
      <NewCharacterCard />
      {draftName !== null && <DraftRow name={draftName} />}
      <div className="v2-make-gap-24" aria-hidden="true" />
      <OtherMakes />
      <div className="v2-make-gap-24" aria-hidden="true" />
      <SectionHead title="つくったもの" />
      {children}
    </div>
  </main>
);

const CreatePage = () => {
  const { ownerUserId, ...lists } = routeApi.useLoaderData();
  const draftName = useNewCharacterDraft(ownerUserId);
  return (
    <CreateFrame draftName={draftName}>
      <MadeThings {...lists} />
    </CreateFrame>
  );
};

const CreatePending = () => (
  <CreateFrame draftName={null}>
    <SectionHead title="つくった子" level={3} />
    <SkeletonRows count={3} />
  </CreateFrame>
);

const CreateError = () => {
  const router = useRouter();
  return (
    <CreateFrame draftName={null}>
      <ErrorCard
        message="つくったものを読み込めませんでした。"
        onRetry={() => void router.invalidate()}
      />
    </CreateFrame>
  );
};

export const Route = createFileRoute("/create")({
  loader: async ({ abortController }) => {
    const signal = abortController.signal;
    const [identity, characters, stories, clips, groups] = await Promise.all([
      readCharacterEditorIdentity(),
      listCharacters({ signal }),
      listStories(),
      listClips(),
      listUserGroups(),
    ]);
    return {
      ownerUserId: identity.ownerUserId,
      characters,
      stories,
      clips,
      groups,
    };
  },
  pendingComponent: CreatePending,
  errorComponent: CreateError,
  component: CreatePage,
});
