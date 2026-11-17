import { createFileRoute, getRouteApi, Link, useNavigate } from "@tanstack/react-router";

import { CharacterEditor } from "../../component/character-editor";
import { PublishToggle } from "../../component/publish-toggle";
import { VoicePanel } from "../../component/voice-panel";
import { avatarUrl } from "../../lib/avatar-url";
import { getCharacter } from "../../server/characters";
import { readCharacterEditorIdentity } from "../../server/character-editor-identity";

import "../../component/profile-screen.css";

const routeApi = getRouteApi("/characters/$id");

const BackIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.0"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M15 5l-7 7 7 7" />
  </svg>
);

type ProfileCharacter = {
  id: string;
  name: string;
  avatar: string | null;
  greeting: string;
  tags: string[];
};

// 絵がある子は絵の頭（420px＋縁）、無い子はふつうの頭（板 Profile の二系統）
const ProfileHead = ({ character }: { character: ProfileCharacter }) => {
  const image = avatarUrl(character.id, character.avatar);
  if (!image) {
    return (
      <header className="v2-profile-plain-head">
        <Link to="/my" aria-label="戻る">
          <BackIcon />
        </Link>
        <h1>プロフィール</h1>
      </header>
    );
  }
  return (
    <div className="v2-profile-hero">
      <img src={image} alt={character.name} />
      <div className="v2-profile-hero-edge" aria-hidden="true" />
      <div className="v2-profile-plate">
        <Link to="/my" aria-label="戻る">
          <BackIcon />
        </Link>
        <span>プロフィール</span>
      </div>
    </div>
  );
};

const ProfileTags = ({ tags }: { tags: string[] }) => {
  if (tags.length === 0) return null;
  return (
    <>
      <div className="v2-profile-meta">{tags[0]}</div>
      <div className="v2-profile-tags" aria-label="札">
        {tags.map((tag) => (
          <span key={tag}>
            <b>#</b> {tag}
          </span>
        ))}
      </div>
    </>
  );
};

const EditCharacterPage = () => {
  const { ownerUserId, character } = routeApi.useLoaderData();
  const { id } = routeApi.useParams();
  const navigate = useNavigate();
  return (
    <main className="v2-profile-page">
      {character && <ProfileHead character={character} />}
      <div className="v2-profile-sheet">
        <h1 className="v2-profile-name">{character?.name ?? ""}</h1>
        {character && <ProfileTags tags={character.tags} />}

        {character?.greeting && (
          <>
            <div className="v2-profile-spacer-16" aria-hidden="true" />
            <h2 className="v2-profile-section">はじまりのひとこと</h2>
            <div className="v2-profile-greeting">{character.greeting}</div>
          </>
        )}

        <Link
          to="/chat/$id"
          params={{ id }}
          search={{ newChat: crypto.randomUUID() }}
          className="v2-profile-cta"
          aria-label={`${character?.name ?? "この子"}と話す`}
        >
          <span>話す</span>
        </Link>

        <div className="v2-profile-spacer-24" aria-hidden="true" />
        <h2 className="v2-profile-section">編集</h2>
        <CharacterEditor
          key={id}
          characterId={id}
          ownerUserId={ownerUserId}
          onSaved={async (characterId) => {
            await navigate({
              to: "/chat/$id",
              params: { id: characterId },
              search: { newChat: crypto.randomUUID() },
            });
          }}
        />
        <PublishToggle characterId={id} />
        <VoicePanel characterId={id} />
      </div>
    </main>
  );
};

export const Route = createFileRoute("/characters/$id")({
  loader: async ({ params, abortController }) => {
    const [owner, character] = await Promise.all([
      readCharacterEditorIdentity(),
      getCharacter({ data: params.id, signal: abortController.signal }),
    ]);
    return { ...owner, character };
  },
  component: EditCharacterPage,
});
