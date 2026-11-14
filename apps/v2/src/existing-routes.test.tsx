import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppTabBar } from "./component/app-tab-bar";
import { Route as ListRoute } from "./routes/index";

import type { AnyRootRoute } from "@tanstack/react-router";

vi.mock("./server/characters", () => ({
  listCharacters: async () => [{ id: "synthetic-character", name: "合成の一覧項目", avatar: null }],
  listSavedConversations: async () => [],
}));

// 下タブを足しても、既存の URL を一つも消していないことを固定する。
// routeTree.gen.ts を import すると server 側（cloudflare:workers）まで引くので本文で見る。
const MUST_STAY = [
  "/",
  "/chat/$id",
  "/characters/new",
  "/characters/$id",
  "/catalog",
  "/clips",
  "/create",
  "/stories",
  "/stories/$id",
  "/stories/$id/read",
  "/groups",
  "/groups/$id",
  "/board",
  "/revenue",
  "/album",
  "/my",
];

afterEach(cleanup);

describe("既存ルートの維持", () => {
  it("既存の全ルートと新しいタブ先が routeTree に登録されたまま", () => {
    const tree = readFileSync(resolve(__dirname, "routeTree.gen.ts"), "utf8");
    const registered = new Set(
      [...tree.matchAll(/^\s+fullPath: '([^']+)'/gm)].map((match) =>
        match[1].length > 1 ? match[1].replace(/\/$/, "") : match[1],
      ),
    );
    for (const path of MUST_STAY) {
      expect(registered.has(path), `${path} が routeTree に無い`).toBe(true);
    }
  });

  it("ホームの一覧は帯つきでも従来どおり描画される", async () => {
    const root = createRootRoute({
      component: () => (
        <>
          <div id="root">
            <Outlet />
          </div>
          <AppTabBar />
        </>
      ),
    });
    const home = createRoute({
      getParentRoute: (): AnyRootRoute => root,
      path: "/",
      loader: ListRoute.options.loader,
      component: ListRoute.options.component,
    });
    const router = createRouter({
      routeTree: root.addChildren([home]),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    render(<RouterProvider router={router} />);
    await waitFor(() => expect(screen.getByText("合成の一覧項目")).toBeInTheDocument());
    expect(screen.getByRole("navigation", { name: "メイン" })).toBeInTheDocument();
  });
});
