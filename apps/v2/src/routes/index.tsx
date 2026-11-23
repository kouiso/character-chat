import { createFileRoute, getRouteApi, useRouter } from "@tanstack/react-router";

import {
  HomeEmptyScreen,
  HomeErrorScreen,
  HomeLoadingScreen,
  HomeScreen,
  type HomeContinuation,
  type HomeHeroData,
} from "../component/home-screen";
import { ScreenBand, useSlowFlag } from "../component/screen-state";
import { useChatOnline } from "../lib/chat-online";
import { listCharacters, listSavedConversations } from "../server/characters";
import { listSavedGroups } from "../server/groups";

import "../component/home-screen.css";

const routeApi = getRouteApi("/");

const useRetryHome = () => {
  const router = useRouter();
  return () => {
    // 帯・状態の「もう一度」は同じ URL への移動だけで再取得が省略されんよう明示する。
    void router.invalidate({ filter: (match) => match.routeId === "/", forcePending: true });
  };
};

// 読み込み中（骨組み）。長引いた時は帯、まだ何も出ていない時のオフラインは題つきの形
const HomePendingState = () => {
  const online = useChatOnline();
  const slow = useSlowFlag();
  const retry = useRetryHome();
  return online ? (
    <HomeLoadingScreen slow={slow} onRetry={retry} />
  ) : (
    <HomeErrorScreen offline onRetry={retry} />
  );
};

const HomeErrorState = () => {
  const online = useChatOnline();
  const retry = useRetryHome();
  return <HomeErrorScreen offline={!online} onRetry={retry} />;
};

const HomePage = () => {
  const { characters, conversations, groups } = routeApi.useLoaderData();
  const online = useChatOnline();
  const retry = useRetryHome();
  const byId = new Map(characters.map((c) => [c.id, c]));

  // 「いつもの子」に留める枠はまだ無いので、いちばん新しく話した子を主役にする
  // （板 HomeEmpty「留めた子がいない時」の「さいきん話した子」）。
  const latest = conversations.find((conversation) => byId.has(conversation.characterId));
  const heroCharacter = latest ? byId.get(latest.characterId) : undefined;
  const hero: HomeHeroData | undefined =
    heroCharacter && latest ? { character: heroCharacter, pinned: false, latest } : undefined;

  // つづきからは会話と場を新しい順に混ぜる。主役にした会話は除く（板 Main）。
  const continuations: HomeContinuation[] = [
    ...conversations.flatMap((conversation) => {
      const character = byId.get(conversation.characterId);
      return character && conversation.id !== latest?.id
        ? [{ kind: "chat" as const, conversation, character }]
        : [];
    }),
    ...groups.map((group) => ({
      kind: "group" as const,
      group,
      speaker: group.speakerCharacterId ? byId.get(group.speakerCharacterId) : undefined,
      faces: group.memberIds.flatMap((id) => {
        const character = byId.get(id);
        return character ? [character] : [];
      }),
    })),
  ].sort((a, b) => {
    const at = a.kind === "chat" ? a.conversation.updatedAt : a.group.updatedAt;
    const bt = b.kind === "chat" ? b.conversation.updatedAt : b.group.updatedAt;
    return bt - at;
  });

  return (
    <div className={online ? "v2-home" : "v2-home v2-home--band"}>
      {hero ? <HomeScreen hero={hero} continuations={continuations} /> : <HomeEmptyScreen />}
      {!online && <ScreenBand kind="alert" text="オフラインです" onRetry={retry} tab />}
    </div>
  );
};

export const Route = createFileRoute("/")({
  pendingComponent: HomePendingState,
  errorComponent: HomeErrorState,
  loader: async ({ abortController }) => {
    const [characters, conversations, groups] = await Promise.all([
      listCharacters({ signal: abortController.signal }),
      listSavedConversations({ signal: abortController.signal }),
      listSavedGroups({ signal: abortController.signal }),
    ]);
    return { characters, conversations, groups };
  },
  component: HomePage,
});
