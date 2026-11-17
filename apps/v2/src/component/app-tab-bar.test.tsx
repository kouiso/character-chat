import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AppTabBar, TABS } from "./app-tab-bar";

import type { AnyRootRoute } from "@tanstack/react-router";

const EXPECTED_LABELS = ["ホーム", "出会う", "つくる", "アルバム", "マイ"];

const renderShell = async (entry: string) => {
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
  const paths = [
    "/",
    "/catalog",
    "/create",
    "/characters/new",
    "/album",
    "/my",
    "/chat/$id",
    "/groups/$id",
  ];
  const children = paths.map((path) =>
    createRoute({
      getParentRoute: (): AnyRootRoute => root,
      path,
      component: () => <p data-testid="page">{path}</p>,
    }),
  );
  const router = createRouter({
    routeTree: root.addChildren(children),
    history: createMemoryHistory({ initialEntries: [entry] }),
  });
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(screen.getByTestId("page")).toBeInTheDocument());
  return router;
};

afterEach(cleanup);

describe("AppTabBar", () => {
  it("5 タブを見本どおりのラベルと順で出す", async () => {
    await renderShell("/");
    const nav = screen.getByRole("navigation", { name: "メイン" });
    const labels = within(nav)
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(labels).toEqual(EXPECTED_LABELS);
    expect(TABS.map((tab) => tab.label)).toEqual(EXPECTED_LABELS);
  });

  it("各タブが対応する画面へ移る", async () => {
    const router = await renderShell("/");
    const expected: Record<string, string> = {
      ホーム: "/",
      出会う: "/catalog",
      つくる: "/create",
      アルバム: "/album",
      マイ: "/my",
    };
    for (const [label, path] of Object.entries(expected).reverse()) {
      fireEvent.click(screen.getByRole("link", { name: label }));
      await waitFor(() => expect(router.state.location.pathname).toBe(path));
      await waitFor(() =>
        expect(screen.getByRole("link", { name: label })).toHaveAttribute("aria-current", "page"),
      );
    }
  });

  it("開いている画面のタブだけ aria-current を持つ", async () => {
    await renderShell("/catalog");
    const current = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");
    expect(current.map((link) => link.textContent)).toEqual(["出会う"]);
  });

  it("つくるの奥の画面（戻るの付く画面）では帯を出さない", async () => {
    await renderShell("/characters/new");
    expect(screen.queryByRole("navigation", { name: "メイン" })).toBeNull();
  });

  it("会話画面では帯を出さない（Talk ボードに帯は無い）", async () => {
    await renderShell("/chat/abc");
    expect(screen.queryByRole("navigation", { name: "メイン" })).toBeNull();
  });
});
