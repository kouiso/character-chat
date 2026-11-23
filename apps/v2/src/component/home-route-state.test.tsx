// ホーム経路の状態（板 HomeStates）: 読み込み中の骨組み、長引いた時の帯、読めない時、
// まだ何も出ていない時/ホームが出ている時のオフライン、見つからないページを確かめる。
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Route as HomeRoute } from "../routes/index";

import { AppErrorState, AppLoadingState, AppNotFoundState } from "./app-route-state";
import { ChatConnectionState } from "./chat-route-state";
import { SLOW_STATE_MS } from "./screen-state";

import type { AnyRootRoute } from "@tanstack/react-router";

const { listCharacters, listSavedConversations, listSavedGroups } = vi.hoisted(() => ({
  listCharacters: vi.fn(),
  listSavedConversations: vi.fn(),
  listSavedGroups: vi.fn(),
}));
vi.mock("../server/characters", () => ({ listCharacters, listSavedConversations }));
vi.mock("../server/groups", () => ({ listSavedGroups }));

const fixture = [{ id: "synthetic-character", name: "合成のいつもの子", avatar: null, tags: [] }];
const talkFixture = [
  {
    id: "synthetic-talk",
    characterId: "synthetic-character",
    title: "",
    updatedAt: Date.now(),
    lastMessage: "おかえり",
  },
];

const renderHome = (entry = "/", rootLoader?: () => Promise<null>) => {
  const root = createRootRoute({
    component: Outlet,
    loader: rootLoader,
    pendingComponent: AppLoadingState,
    errorComponent: AppErrorState,
    notFoundComponent: AppNotFoundState,
  });
  const home = createRoute({
    getParentRoute: (): AnyRootRoute => root,
    path: "/",
    loader: HomeRoute.options.loader,
    component: HomeRoute.options.component,
    pendingComponent: HomeRoute.options.pendingComponent,
    errorComponent: HomeRoute.options.errorComponent,
  });
  const chat = createRoute({
    getParentRoute: () => root,
    path: "/chat/$id",
    component: ChatConnectionState,
  });
  const router = createRouter({
    routeTree: root.addChildren([home, chat]),
    history: createMemoryHistory({ initialEntries: [entry] }),
    defaultPendingMs: 0,
    defaultPendingMinMs: 0,
  });
  render(<RouterProvider router={router} />);
  return router;
};

const setOnline = (online: boolean) => {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: online });
  void act(() => window.dispatchEvent(new Event(online ? "online" : "offline")));
};

beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  listCharacters.mockReset();
  listSavedConversations.mockReset();
  listSavedGroups.mockReset();
  listSavedConversations.mockResolvedValue(talkFixture);
  listSavedGroups.mockResolvedValue([]);
  setOnline(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("ホームの読み込み・失敗・オフライン", () => {
  it("読み込み中は骨組みを role=status で出し、長引くと帯でもう一度を出せる", async () => {
    vi.useFakeTimers();
    let previousSignal: AbortSignal | undefined;
    listCharacters
      .mockImplementationOnce(({ signal }: { signal: AbortSignal }) => {
        previousSignal = signal;
        return new Promise(() => {});
      })
      .mockResolvedValue(fixture);
    renderHome();
    await act(async () => {
      vi.advanceTimersByTime(SLOW_STATE_MS);
    });
    expect(screen.getByText("時間がかかっています")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "もう一度" }));
    await act(async () => {
      await vi.runAllTicks();
    });
    expect(listCharacters).toHaveBeenCalledTimes(2);
    expect(previousSignal?.aborted).toBe(true);
    expect(
      await vi.waitFor(() => screen.getByRole("heading", { name: "合成のいつもの子" })),
    ).toBeInTheDocument();
  });

  it("読み込み中（短時間）は骨組みだけで帯は出さない", async () => {
    listCharacters.mockImplementationOnce(() => new Promise(() => {}));
    renderHome();
    expect(await screen.findByRole("status", { name: "読み込んでいます" })).toBeInTheDocument();
    expect(screen.queryByText("時間がかかっています")).not.toBeInTheDocument();
  });

  it("読めない時は題つきの形から、もう一度で実ホームを復帰する", async () => {
    listCharacters
      .mockRejectedValueOnce(new Error("synthetic-list-failure"))
      .mockResolvedValue(fixture);
    renderHome();
    const alert = await screen.findByRole("alert");
    expect(
      within(alert).getByRole("heading", { name: "ホームを読み込めませんでした" }),
    ).toBeInTheDocument();
    expect(alert).not.toHaveTextContent("synthetic-list-failure");
    fireEvent.click(within(alert).getByRole("button", { name: "もう一度" }));
    expect(await screen.findByRole("heading", { name: "合成のいつもの子" })).toBeInTheDocument();
  });

  it("戻り先のホームが読めなくても、もう一度の出口がある", async () => {
    listCharacters
      .mockRejectedValueOnce(new Error("synthetic-list-failure"))
      .mockResolvedValue(fixture);
    renderHome("/chat/synthetic-character");
    fireEvent.click(await screen.findByRole("link", { name: "一覧に戻る" }));
    await screen.findByRole("heading", { name: "ホームを読み込めませんでした" });
    fireEvent.click(screen.getByRole("button", { name: "もう一度" }));
    expect(await screen.findByRole("heading", { name: "合成のいつもの子" })).toBeInTheDocument();
  });

  it("話した子がいない時は空のホームを出す（やり直しは帯・失敗側だけ）", async () => {
    listCharacters.mockResolvedValueOnce(fixture);
    listSavedConversations.mockResolvedValueOnce([]);
    renderHome();
    await screen.findByRole("heading", { name: "まだ、いつもの子はいません" });
    expect(screen.getByRole("link", { name: "出会うへ" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "もう一度" })).not.toBeInTheDocument();
  });

  it("まだ何も出ていない時のオフラインは題つきの形で一手を絞る", async () => {
    vi.useFakeTimers();
    setOnline(false);
    listCharacters.mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue(fixture);
    renderHome();
    const alert = await vi.waitFor(() => screen.getByRole("alert"));
    expect(within(alert).getByRole("heading", { name: "オフラインです" })).toBeInTheDocument();
    expect(within(alert).getByText("つながったら、もう一度読み込めます。")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "もう一度" })).toHaveLength(1);
    // つながり直すと骨組みへ戻る。帯が出たら「もう一度」で手動の再試行ができる
    setOnline(true);
    await act(async () => {
      vi.advanceTimersByTime(SLOW_STATE_MS);
    });
    fireEvent.click(screen.getByRole("button", { name: "もう一度" }));
    await act(async () => {
      await vi.runAllTicks();
    });
    expect(
      await vi.waitFor(() => screen.getByRole("heading", { name: "合成のいつもの子" })),
    ).toBeInTheDocument();
  });

  it("オフラインで読み込みが失敗し続けても、もう一度のボタンは残る", async () => {
    setOnline(false);
    listCharacters.mockRejectedValue(new Error("synthetic-offline-failure"));
    const router = renderHome();
    await vi.waitFor(() =>
      expect(router.state.matches.find((match) => match.routeId === "/")?.status).toBe("error"),
    );
    const retry = await screen.findByRole("button", { name: "もう一度" });
    fireEvent.click(retry);
    expect(screen.getByRole("button", { name: "もう一度" })).toBeEnabled();
    await vi.waitFor(() => expect(listCharacters).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("heading", { name: "オフラインです" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "もう一度" })).toBeEnabled();
  });

  it("ホームが出ている時のオフラインは帯で知らせ、中身はそのまま残す", async () => {
    listCharacters.mockResolvedValue(fixture);
    renderHome();
    await screen.findByRole("heading", { name: "合成のいつもの子" });
    setOnline(false);
    expect(await screen.findByText("オフラインです")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "もう一度" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "合成のいつもの子" })).toBeInTheDocument();
    setOnline(true);
    expect(listCharacters).toHaveBeenCalledTimes(1);
  });

  it("空のホームが出ている時のオフラインも帯で知らせ、操作は帯の一手だけ", async () => {
    listCharacters.mockResolvedValueOnce(fixture);
    listSavedConversations.mockResolvedValueOnce([]);
    renderHome();
    await screen.findByRole("heading", { name: "まだ、いつもの子はいません" });
    setOnline(false);
    expect(await screen.findByText("オフラインです")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "もう一度" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "出会うへ" })).toBeInTheDocument();
  });
});

describe("ホームを囲む画面まるごとの状態（板 HomeStates「ほかの画面」「見つからないページ」）", () => {
  it("見つからないページからホームへ戻れる", async () => {
    listCharacters.mockResolvedValue(fixture);
    renderHome("/unknown");
    expect(
      await screen.findByRole("heading", { name: "このページが見つかりませんでした" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "ホームへ" }));
    expect(await screen.findByRole("heading", { name: "合成のいつもの子" })).toBeInTheDocument();
  });

  it("ほかの画面: 読めない時は題つきの形から、もう一度で復帰する", async () => {
    listCharacters.mockResolvedValue(fixture);
    const rootLoader = vi
      .fn()
      .mockRejectedValueOnce(new Error("synthetic-root-failure"))
      .mockResolvedValue(null);
    renderHome("/", rootLoader);
    const alert = await screen.findByRole("alert");
    expect(
      within(alert).getByRole("heading", { name: "ページを読み込めませんでした" }),
    ).toBeInTheDocument();
    fireEvent.click(within(alert).getByRole("button", { name: "もう一度" }));
    expect(await screen.findByRole("heading", { name: "合成のいつもの子" })).toBeInTheDocument();
    expect(rootLoader).toHaveBeenCalledTimes(2);
  });

  it("ほかの画面: 読み込みが長引いた時は帯からもう一度を出せる", async () => {
    vi.useFakeTimers();
    listCharacters.mockResolvedValue(fixture);
    const rootLoader = vi
      .fn()
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValue(null);
    renderHome("/", rootLoader);
    await act(async () => {
      vi.advanceTimersByTime(SLOW_STATE_MS);
    });
    expect(screen.getByText("時間がかかっています")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "もう一度" }));
    await act(async () => {
      await vi.runAllTicks();
    });
    expect(rootLoader).toHaveBeenCalledTimes(2);
    expect(
      await vi.waitFor(() => screen.getByRole("heading", { name: "合成のいつもの子" })),
    ).toBeInTheDocument();
  });
});
