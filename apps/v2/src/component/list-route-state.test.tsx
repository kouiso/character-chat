import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Route as RootRoute } from "../routes/__root";
import { Route as ListRoute } from "../routes/index";

import { ChatConnectionState } from "./chat-route-state";

import type { AnyRootRoute } from "@tanstack/react-router";

const { listCharacters, listEditableCharacters } = vi.hoisted(() => ({
  listCharacters: vi.fn(),
  listEditableCharacters: vi.fn(),
}));
vi.mock("../server/characters", () => ({
  listCharacters,
  listEditableCharacters,
  loadCharacterEditor: vi.fn(),
  saveCharacterEditor: vi.fn(),
  restoreCharacterEditor: vi.fn(),
}));

const fixture = [{ id: "synthetic-character", name: "合成の一覧項目", avatar: null }];

const renderList = (entry = "/", rootLoader?: () => Promise<null>) => {
  const root = createRootRoute({
    component: Outlet,
    loader: rootLoader,
    pendingComponent: RootRoute.options.pendingComponent,
    errorComponent: RootRoute.options.errorComponent,
    notFoundComponent: RootRoute.options.notFoundComponent,
  });
  const list = createRoute({
    getParentRoute: (): AnyRootRoute => root,
    path: "/",
    loader: ListRoute.options.loader,
    component: ListRoute.options.component,
    pendingComponent: ListRoute.options.pendingComponent,
    errorComponent: ListRoute.options.errorComponent,
  });
  const chat = createRoute({
    getParentRoute: () => root,
    path: "/chat/$id",
    component: ChatConnectionState,
  });
  const router = createRouter({
    routeTree: root.addChildren([list, chat]),
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
  listEditableCharacters.mockReset().mockResolvedValue({
    ok: true,
    data: { actorKey: "synthetic-actor", characters: [] },
  });
  setOnline(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("list and root recovery", () => {
  it("空の一覧でも実キャラクター作成フォームへ進める", async () => {
    listCharacters.mockResolvedValue([]);
    renderList();
    await screen.findByRole("heading", { name: "キャラクターがありません" });
    fireEvent.click(screen.getByRole("button", { name: "キャラクターを作る" }));
    expect(await screen.findByLabelText("名前")).toBeInTheDocument();
    expect(listEditableCharacters).toHaveBeenCalledOnce();
  });

  it("一覧待機中に再試行でき、古い待機に閉じ込められない", async () => {
    listCharacters.mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue(fixture);
    renderList();
    await screen.findByRole("heading", { name: "一覧を読み込んでいます" });
    fireEvent.click(screen.getByRole("button", { name: "読み込みをやり直す" }));
    expect(
      await screen.findByRole("link", { name: `${fixture[0].name}と話す` }),
    ).toBeInTheDocument();
    expect(listCharacters).toHaveBeenCalledTimes(2);
  });

  it("一覧失敗から再試行して実一覧を復帰する", async () => {
    listCharacters
      .mockRejectedValueOnce(new Error("synthetic-list-failure"))
      .mockResolvedValue(fixture);
    renderList();
    await screen.findByRole("heading", { name: "一覧を読み込めませんでした" });
    expect(screen.queryByText("synthetic-list-failure")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "読み込みをやり直す" }));
    expect(
      await screen.findByRole("link", { name: `${fixture[0].name}と話す` }),
    ).toBeInTheDocument();
  });

  it("戻り先の一覧が失敗しても再試行の出口がある", async () => {
    listCharacters
      .mockRejectedValueOnce(new Error("synthetic-list-failure"))
      .mockResolvedValue(fixture);
    renderList("/chat/synthetic-character");
    fireEvent.click(await screen.findByRole("link", { name: "一覧に戻る" }));
    await screen.findByRole("heading", { name: "一覧を読み込めませんでした" });
    fireEvent.click(screen.getByRole("button", { name: "読み込みをやり直す" }));
    expect(
      await screen.findByRole("link", { name: `${fixture[0].name}と話す` }),
    ).toBeInTheDocument();
  });

  it("一覧0件から読み込みをやり直せる", async () => {
    listCharacters.mockResolvedValueOnce([]).mockResolvedValue(fixture);
    renderList();
    await screen.findByRole("heading", { name: "キャラクターがありません" });
    fireEvent.click(screen.getByRole("button", { name: "読み込みをやり直す" }));
    expect(
      await screen.findByRole("link", { name: `${fixture[0].name}と話す` }),
    ).toBeInTheDocument();
  });

  it("圏外かつ0件は復帰操作を重複表示しない", async () => {
    listCharacters.mockResolvedValueOnce([]).mockResolvedValue(fixture);
    renderList();
    await screen.findByRole("heading", { name: "キャラクターがありません" });
    setOnline(false);
    expect(await screen.findByRole("heading", { name: "オフラインです" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "読み込みをやり直す" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "読み込みをやり直す" }));
    setOnline(true);
    expect(
      await screen.findByRole("link", { name: `${fixture[0].name}と話す` }),
    ).toBeInTheDocument();
  });

  it("圏外の一覧待機から復帰後に手動で再試行できる", async () => {
    setOnline(false);
    listCharacters.mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue(fixture);
    renderList();
    await screen.findByRole("heading", { name: "オフラインです" });
    setOnline(true);
    expect(listCharacters).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "読み込みをやり直す" }));
    expect(
      await screen.findByRole("link", { name: `${fixture[0].name}と話す` }),
    ).toBeInTheDocument();
  });

  it("圏外で一覧失敗が続いても再試行ボタンが残る", async () => {
    setOnline(false);
    listCharacters.mockRejectedValue(new Error("synthetic-offline-failure"));
    const router = renderList();
    await vi.waitFor(() =>
      expect(router.state.matches.find((match) => match.routeId === "/")?.status).toBe("error"),
    );
    const retry = await screen.findByRole("button", { name: "読み込みをやり直す" });
    fireEvent.click(retry);
    expect(screen.getByRole("button", { name: "読み込みをやり直す" })).toBeEnabled();
    setOnline(true);
    await vi.waitFor(() => expect(listCharacters).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByRole("heading", { name: "一覧を読み込めませんでした" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "読み込みをやり直す" })).toBeEnabled();
  });

  it("一覧表示中の圏外でも項目を残し、自動取得しない", async () => {
    listCharacters.mockResolvedValue(fixture);
    renderList();
    await screen.findByRole("link", { name: `${fixture[0].name}と話す` });
    setOnline(false);
    expect(await screen.findByRole("heading", { name: "オフラインです" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: `${fixture[0].name}と話す` })).toBeInTheDocument();
    setOnline(true);
    expect(listCharacters).toHaveBeenCalledTimes(1);
  });

  it("root接続契約: 不明URLから実一覧へ戻れる", async () => {
    listCharacters.mockResolvedValue(fixture);
    renderList("/unknown");
    await screen.findByRole("heading", { name: "ページが見つかりません" });
    fireEvent.click(screen.getByRole("link", { name: "一覧に戻る" }));
    expect(
      await screen.findByRole("link", { name: `${fixture[0].name}と話す` }),
    ).toBeInTheDocument();
  });

  it("root接続契約: root loader失敗から再試行できる", async () => {
    listCharacters.mockResolvedValue(fixture);
    const rootLoader = vi
      .fn()
      .mockRejectedValueOnce(new Error("synthetic-root-failure"))
      .mockResolvedValue(null);
    renderList("/", rootLoader);
    await screen.findByRole("heading", { name: "画面を読み込めませんでした" });
    fireEvent.click(screen.getByRole("button", { name: "読み込みをやり直す" }));
    expect(
      await screen.findByRole("link", { name: `${fixture[0].name}と話す` }),
    ).toBeInTheDocument();
    expect(rootLoader).toHaveBeenCalledTimes(2);
  });

  it("root接続契約: root待機から再試行できる", async () => {
    listCharacters.mockResolvedValue(fixture);
    const rootLoader = vi
      .fn()
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValue(null);
    renderList("/", rootLoader);
    await screen.findByRole("heading", { name: "画面を読み込んでいます" });
    fireEvent.click(screen.getByRole("button", { name: "読み込みをやり直す" }));
    expect(
      await screen.findByRole("link", { name: `${fixture[0].name}と話す` }),
    ).toBeInTheDocument();
    expect(rootLoader).toHaveBeenCalledTimes(2);
  });
});
