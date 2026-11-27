// ホーム（板 Main・HomeEmpty・HomeStates）。主役の子（いつもの子・さいきん話した子）、
// つづきからの行（会話・グループ）、長い名前・絵の無い子・空の状態を板どおりに出せることを確かめる。
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  HomeEmptyScreen,
  HomeErrorScreen,
  HomeLoadingScreen,
  HomeScreen,
  formatHomeDay,
  type HomeContinuation,
} from "./home-screen";

import type { AnyRootRoute } from "@tanstack/react-router";
import type { CharacterListItem } from "../server/characters";

const character = (over: Partial<CharacterListItem> = {}): CharacterListItem => ({
  id: crypto.randomUUID(),
  name: "霜月 鈴",
  avatar: null,
  tags: ["夜型のイラストレーター"],
  canEdit: true,
  playCount: 0,
  ...over,
});

const day = 86_400_000;
const conversation = (characterId: string, over: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(),
  characterId,
  title: "",
  updatedAt: Date.now() - day,
  lastMessage: "…起きてる？ 鍵、開けといた",
  ...over,
});

const renderHome = async (node: React.ReactNode, path = "/") => {
  const root = createRootRoute({ component: () => <Outlet /> });
  const children = [
    createRoute({
      getParentRoute: (): AnyRootRoute => root,
      path: "/",
      component: () => node,
    }),
    createRoute({
      getParentRoute: (): AnyRootRoute => root,
      path: "/characters/$id",
      component: () => <p>profile</p>,
    }),
    createRoute({
      getParentRoute: (): AnyRootRoute => root,
      path: "/chat/$id",
      component: () => <p>chat</p>,
    }),
    createRoute({
      getParentRoute: (): AnyRootRoute => root,
      path: "/groups/$id",
      component: () => <p>group</p>,
    }),
    createRoute({
      getParentRoute: (): AnyRootRoute => root,
      path: "/catalog",
      component: () => <p>catalog</p>,
    }),
    createRoute({
      getParentRoute: (): AnyRootRoute => root,
      path: "/my",
      component: () => <p>my</p>,
    }),
    createRoute({
      getParentRoute: (): AnyRootRoute => root,
      path: "/settings",
      component: () => <p>settings</p>,
    }),
  ];
  const router = createRouter({
    routeTree: root.addChildren(children),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(router.state.location.pathname).toBe(path));
  return router;
};

afterEach(cleanup);

describe("ホーム（いつもの子が迎える）", () => {
  it("さいきん話した子の札・新着・名前・吹き出し・主ボタンを板どおり出す", async () => {
    const hero = character({ name: "霜月 鈴", tags: ["夜型のイラストレーター"] });
    const latest = conversation(hero.id);
    await renderHome(
      <HomeScreen hero={{ character: hero, pinned: false, latest }} continuations={[]} />,
    );
    expect(
      screen.getByRole("link", { name: `さいきん話した子 ${hero.name}のプロフィール` }),
    ).toHaveAttribute("href", `/characters/${hero.id}`);
    expect(screen.getByText("新着")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "霜月 鈴" })).toBeInTheDocument();
    expect(screen.getByText("夜型のイラストレーター")).toBeInTheDocument();
    expect(screen.getByText("「…起きてる？ 鍵、開けといた」")).toBeInTheDocument();
    const primary = screen.getByRole("link", { name: "霜月 鈴と、ゆうべのつづきを話す" });
    expect(primary).toHaveAttribute("href", expect.stringContaining(`/chat/${hero.id}`));
    expect(within(primary).getByText("ゆうべのつづき")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "設定を開く" })).toHaveAttribute("href", "/settings");
    const newChat = screen.getByRole("link", { name: `${hero.name}と新しい会話を始める` });
    expect(newChat).toHaveAttribute("href", expect.stringContaining(`/chat/${hero.id}`));
    expect(newChat).toHaveAttribute("href", expect.stringContaining("newChat="));
  });

  it("留めた子は「いつもの子」の札で迎える（Main 板の形）", async () => {
    const hero = character({ name: "ひなた" });
    const latest = conversation(hero.id);
    await renderHome(
      <HomeScreen hero={{ character: hero, pinned: true, latest }} continuations={[]} />,
    );
    expect(
      screen.getByRole("link", {
        name: `いつもの子（プロフィールで留めた子）${hero.name}のプロフィール`,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("いつもの子")).toBeInTheDocument();
  });

  it("つづきからに会話とグループを新しい順に並べ、行き先へ送る", async () => {
    const hero = character({ name: "霜月 鈴" });
    const latest = conversation(hero.id, { updatedAt: Date.now() - day });
    const other = character({ name: "さくら" });
    const older = conversation(other.id, {
      updatedAt: Date.now() - 3 * day,
      lastMessage: "また、あのカフェで",
    });
    const memberA = character({ name: "ひなた" });
    const memberB = character({ name: "夜々" });
    const group = {
      id: "group-1",
      title: "宅飲みの夜",
      updatedAt: Date.now() - 2 * day,
      speakerCharacterId: memberA.id,
      lastMessage: "おつかれさまです。隣、いいですか？",
      memberIds: [memberA.id, memberB.id],
    };
    const continuations: HomeContinuation[] = [
      { kind: "chat", conversation: older, character: other },
      {
        kind: "group",
        group,
        speaker: memberA,
        faces: [memberA, memberB],
      },
    ];
    continuations.sort((a, b) => {
      const at = a.kind === "chat" ? a.conversation.updatedAt : a.group.updatedAt;
      const bt = b.kind === "chat" ? b.conversation.updatedAt : b.group.updatedAt;
      return bt - at;
    });
    await renderHome(
      <HomeScreen
        hero={{ character: hero, pinned: false, latest }}
        continuations={continuations}
      />,
    );
    expect(screen.getByRole("heading", { name: "つづきから" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "履歴" })).toHaveAttribute("href", "/my");
    const groupRow = screen.getByRole("link", { name: "宅飲みの夜との会話をつづきから話す" });
    expect(groupRow).toHaveAttribute("href", "/groups/group-1");
    expect(
      within(groupRow).getByText("ひなた「おつかれさまです。隣、いいですか？」"),
    ).toBeInTheDocument();
    const chatRow = screen.getByRole("link", { name: "さくらとの会話をつづきから話す" });
    expect(chatRow).toHaveAttribute("href", expect.stringContaining(`/chat/${other.id}`));
    expect(within(chatRow).getByText("「また、あのカフェで」")).toBeInTheDocument();
    // 行ごとにキャラクター名（読み上げの名前でなく見える字）と最終更新日が出る（#170）。
    // 2・3 日前は曜日で書く（WORDING.md）
    expect(within(chatRow).getByText("さくら")).toBeInTheDocument();
    expect(within(groupRow).getByText("宅飲みの夜")).toBeInTheDocument();
    const weekdays = ["日曜", "月曜", "火曜", "水曜", "木曜", "金曜", "土曜"] as const;
    expect(
      within(chatRow).getByText(weekdays[new Date(older.updatedAt).getDay()]),
    ).toBeInTheDocument();
    expect(
      within(groupRow).getByText(weekdays[new Date(group.updatedAt).getDay()]),
    ).toBeInTheDocument();
    // グループ（2 日前）が会話（3 日前）より先に並ぶ
    expect(
      groupRow.compareDocumentPosition(chatRow) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("1 対 1 が無く場だけある時は主役無しで「つづきから」を出す", async () => {
    const member = character({ name: "ひなた" });
    const group = {
      id: "group-only",
      title: "宅飲みの夜",
      updatedAt: Date.now() - day,
      speakerCharacterId: member.id,
      lastMessage: "おつかれさまです。隣、いいですか？",
      memberIds: [member.id],
    };
    await renderHome(
      <HomeScreen
        hero={undefined}
        continuations={[{ kind: "group", group, speaker: member, faces: [member] }]}
      />,
    );
    // 主役の札も主ボタンも出さないが、つづきからは見せて再開できる
    expect(screen.queryByText("ゆうべのつづき")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "つづきから" })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "宅飲みの夜との会話をつづきから話す" }),
    ).toHaveAttribute("href", "/groups/group-only");
  });

  it("長い名前と長い文（絵が無い子）でも収める: 頭文字の頭・省略・2 行止め", async () => {
    const hero = character({
      name: "エレオノーラ・ヴァレンティーナ",
      avatar: null,
      tags: ["週末だけ開く、路地裏の小さなバーのバーテンダー"],
    });
    const latest = conversation(hero.id, {
      lastMessage:
        "いらっしゃい。今夜はもう看板を下ろしたから、好きな席に座っていいよ。いつもの、つくろうか",
    });
    await renderHome(
      <HomeScreen hero={{ character: hero, pinned: true, latest }} continuations={[]} />,
    );
    const heading = screen.getByRole("heading", { name: "エレオノーラ・ヴァレンティーナ" });
    expect(heading).toBeInTheDocument();
    expect(screen.getByText("週末だけ開く、路地裏の小さなバーのバーテンダー")).toBeInTheDocument();
    // 絵が無い子は名前の 1 文字目の札が絵の頭になる
    expect(document.querySelector(".v2-home-hero-initial")).toHaveTextContent("エ");
    // 吹き出しは 2 行止めの仕組みを持つ
    expect(document.querySelector(".v2-home-bubble-text")).toBeInTheDocument();
  });
});

describe("ホーム（いつもの子がまだいない時）", () => {
  it("灯の図像・題・文・「出会うへ」を出す", async () => {
    await renderHome(<HomeEmptyScreen />);
    expect(screen.getByRole("heading", { name: "まだ、いつもの子はいません" })).toBeInTheDocument();
    expect(screen.getByText("話しはじめた子が、ここで迎えてくれます。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "出会うへ" })).toHaveAttribute("href", "/catalog");
  });
});

describe("ホーム（読み込み・失敗）", () => {
  it("読み込み中は骨組みを role=status で出し、長引くと帯を足す", async () => {
    const retry = () => {};
    await renderHome(<HomeLoadingScreen slow={false} onRetry={retry} />);
    expect(screen.getByRole("status", { name: "読み込んでいます" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "つづきから" })).toBeInTheDocument();
    expect(screen.queryByText("時間がかかっています")).not.toBeInTheDocument();
    cleanup();
    await renderHome(<HomeLoadingScreen slow onRetry={retry} />);
    expect(screen.getByText("時間がかかっています")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "もう一度" })).toBeInTheDocument();
  });

  it("読めない時は題つきの形＋もう一度（説明文は付けない）", async () => {
    await renderHome(<HomeErrorScreen offline={false} onRetry={() => {}} />);
    const alert = screen.getByRole("alert");
    expect(
      within(alert).getByRole("heading", { name: "ホームを読み込めませんでした" }),
    ).toBeInTheDocument();
    expect(within(alert).getByRole("button", { name: "もう一度" })).toBeInTheDocument();
    expect(alert).not.toHaveTextContent("つながったら");
  });

  it("まだ何も出ていない時のオフラインは題＋副文＋もう一度", async () => {
    await renderHome(<HomeErrorScreen offline onRetry={() => {}} />);
    const alert = screen.getByRole("alert");
    expect(within(alert).getByRole("heading", { name: "オフラインです" })).toBeInTheDocument();
    expect(within(alert).getByText("つながったら、もう一度読み込めます。")).toBeInTheDocument();
    expect(within(alert).getByRole("button", { name: "もう一度" })).toBeInTheDocument();
  });
});

describe("日付の書き方（WORDING.md）", () => {
  it("きょう・きのう・曜日・日付の 4 段を使い分ける", () => {
    expect(formatHomeDay(Date.now())).toBe("きょう");
    expect(formatHomeDay(Date.now() - day)).toBe("きのう");
    const threeDaysAgo = new Date(Date.now() - 3 * day);
    const weekdays = ["日曜", "月曜", "火曜", "水曜", "木曜", "金曜", "土曜"] as const;
    expect(formatHomeDay(threeDaysAgo.getTime())).toBe(weekdays[threeDaysAgo.getDay()]);
    const old = new Date(Date.now() - 30 * day);
    expect(formatHomeDay(old.getTime())).toBe(`${old.getMonth() + 1}月${old.getDate()}日`);
  });
});
