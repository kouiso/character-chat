import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { writeChatSession } from "../lib/chat-session";
import { Route as RootRoute } from "../routes/__root";
import { Route as ChatRoute } from "../routes/chat/$id";
import { Route as ListRoute } from "../routes/index";

import type { AnyRootRoute } from "@tanstack/react-router";

const { getCharacter, listCharacters } = vi.hoisted(() => ({
  getCharacter: vi.fn(),
  listCharacters: vi.fn(),
}));
vi.mock("../server/characters", () => ({
  getCharacter,
  listCharacters,
  listSavedConversations: async () => [],
}));

const fixture = { id: "synthetic-character", name: "合成の一覧項目", avatar: null };
let failRender = false;
const RootFrame = () => {
  if (failRender) throw new Error("synthetic-render-failure");
  return <Outlet />;
};

const renderRecovery = (entry: string, loader?: () => Promise<null>) => {
  const root = createRootRoute({
    component: RootFrame,
    loader,
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
    getParentRoute: (): AnyRootRoute => root,
    path: "/chat/$id",
    loader: ChatRoute.options.loader,
    component: ChatRoute.options.component,
    pendingComponent: ChatRoute.options.pendingComponent,
    errorComponent: ChatRoute.options.errorComponent,
    notFoundComponent: ChatRoute.options.notFoundComponent,
    validateSearch: ChatRoute.options.validateSearch,
  });
  const router = createRouter({
    routeTree: root.addChildren([list, chat]),
    history: createMemoryHistory({ initialEntries: [entry] }),
    defaultPendingMs: 0,
    defaultPendingMinMs: 0,
  });
  render(<RouterProvider router={router} />);
};

beforeEach(() => {
  failRender = false;
  localStorage.clear();
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  getCharacter.mockReset().mockResolvedValue(fixture);
  listCharacters.mockReset().mockResolvedValue([fixture]);
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("production root recovery slots", () => {
  it("描画例外を直した後に再試行で実一覧へ復帰する", async () => {
    failRender = true;
    renderRecovery("/");
    await screen.findByRole("heading", { name: "画面を読み込めませんでした" });
    expect(screen.queryByText("synthetic-render-failure")).not.toBeInTheDocument();
    failRender = false;
    fireEvent.click(screen.getByRole("button", { name: "読み込みをやり直す" }));
    expect(await screen.findByRole("heading", { name: fixture.name })).toBeInTheDocument();
  });

  it("不明URLから戻った一覧も失敗した場合に再試行して復帰する", async () => {
    listCharacters
      .mockReset()
      .mockRejectedValueOnce(new Error("synthetic-list-failure"))
      .mockResolvedValue([fixture]);
    renderRecovery("/unknown");
    await screen.findByRole("heading", { name: "ページが見つかりません" });
    fireEvent.click(screen.getByRole("link", { name: "一覧に戻る" }));
    await screen.findByRole("heading", { name: "一覧を読み込めませんでした" });
    fireEvent.click(screen.getByRole("button", { name: "読み込みをやり直す" }));
    expect(await screen.findByRole("heading", { name: fixture.name })).toBeInTheDocument();
  });

  it("root再試行後の保存済み送信の再接続は同じ受付番号を維持する", async () => {
    const pending = {
      characterId: fixture.id,
      conversationId: "synthetic-conversation",
      requestId: "synthetic-request",
      text: "合成の保留文",
      baseTurn: 1,
    };
    writeChatSession(fixture.id, { version: 1, conversationId: pending.conversationId, pending });
    const posts: unknown[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const path = String(url);
      if (init?.method === "POST") {
        posts.push(JSON.parse(String(init.body)));
        return new Response('event: error\ndata: {"message":"合成の一時失敗","terminal":true}\n\n');
      }
      // 開き直しの受付の調べ: 受付は部屋に残っとる（走っている）と答える。
      if (path.includes("/turn?")) {
        return Response.json({
          active: {
            requestId: pending.requestId,
            kind: "send",
            text: pending.text,
            turn: 1,
          },
          request: {
            requestId: pending.requestId,
            status: "running",
            turn: 1,
            kind: "send",
          },
        });
      }
      // つなぎ直しの GET /events: 失敗の出来事で終わっていたと配る。
      if (path.includes("/events?")) {
        return new Response('event: error\ndata: {"message":"合成の一時失敗","terminal":true}\n\n');
      }
      return Response.json({ history: [], turn: 1 });
    });
    const loader = vi
      .fn()
      .mockRejectedValueOnce(new Error("synthetic-root-failure"))
      .mockResolvedValue(null);
    renderRecovery(`/chat/${fixture.id}`, loader);
    await screen.findByRole("heading", { name: "画面を読み込めませんでした" });
    expect(posts).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "読み込みをやり直す" }));
    // 受付の続きは GET でつなぐので、この時点で POST は出てへん。
    await screen.findByText("返事が届きませんでした。");
    expect(posts).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "もう一度" }));
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({
      conversationId: pending.conversationId,
      requestId: pending.requestId,
      text: pending.text,
      retry: true,
    });
  });
});
