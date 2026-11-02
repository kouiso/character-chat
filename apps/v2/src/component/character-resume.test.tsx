import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { writeChatSession } from "../lib/chat-session";
import { Route as ChatRoute } from "../routes/chat/$id";
import { Route as ListRoute } from "../routes/index";

const { listCharacters, listSavedConversations, getCharacter } = vi.hoisted(() => ({
  listCharacters: vi.fn(),
  listSavedConversations: vi.fn(),
  getCharacter: vi.fn(),
}));
vi.mock("../server/characters", () => ({ listCharacters, listSavedConversations, getCharacter }));

const characters = [
  { id: "first", name: "最初のキャラ", avatar: null },
  { id: "recent", name: "最近のキャラ", avatar: null },
  { id: "unused", name: "未会話のキャラ", avatar: null },
];

const renderApp = () => {
  const root = createRootRoute({ component: Outlet });
  const home = createRoute({ ...ListRoute.options, getParentRoute: () => root, path: "/" });
  const chat = createRoute({ ...ChatRoute.options, getParentRoute: () => root, path: "/chat/$id" });
  const router = createRouter({
    routeTree: root.addChildren([home, chat]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(<RouterProvider router={router} />);
  return router;
};

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  listCharacters.mockReset().mockResolvedValue(characters);
  listSavedConversations.mockReset().mockResolvedValue([]);
  getCharacter
    .mockReset()
    .mockImplementation(({ data }: { data: string }) =>
      Promise.resolve(characters.find((character) => character.id === data)),
    );
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("一覧から前回の会話を再開する", () => {
  it("最後に話したキャラを先頭にし、端末の古い選択ではなく最新会話を1回の操作で開く", async () => {
    listSavedConversations.mockResolvedValue([
      { id: "old", characterId: "recent", title: "以前の会話", updatedAt: 100 },
      { id: "first-chat", characterId: "first", title: "最初の会話", updatedAt: 200 },
      { id: "latest", characterId: "recent", title: "最新の会話", updatedAt: 300 },
    ]);
    writeChatSession("recent", { version: 1, conversationId: "old", pending: null });
    const fetchMock = vi.fn(async () =>
      Response.json({ turn: 2, history: [{ role: "assistant", content: "保存済みの続きです" }] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const router = renderApp();
    const list = await screen.findByRole("list", { name: "キャラクター一覧" });
    const links = within(list).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "最近のキャラ",
      "最初のキャラ",
      "未会話のキャラ",
    ]);
    fireEvent.click(links[0]);
    expect(await screen.findByText("保存済みの続きです")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/chat/recent");
    expect(router.state.location.search).toEqual({ conversationId: "latest" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/chat/recent/history?conversationId=latest",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("会話0件なら元のキャラ順を保ち、新規会話を開く際に履歴取得も送信もしない", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const router = renderApp();
    const list = await screen.findByRole("list", { name: "キャラクター一覧" });
    const links = within(list).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(
      characters.map((character) => character.name),
    );
    fireEvent.click(links[0]);
    await screen.findByRole("textbox");
    expect(router.state.location.pathname).toBe("/chat/first");
    expect(router.state.location.search).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("キャラ0件でも空表示と再試行が残る", async () => {
    listCharacters.mockResolvedValue([]);
    renderApp();
    expect(
      await screen.findByRole("heading", { name: "キャラクターがありません" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "読み込みをやり直す" })).toBeEnabled();
    expect(screen.queryByRole("list", { name: "キャラクター一覧" })).not.toBeInTheDocument();
  });
});
