// 「覚えた：…」リンク（RIT-92）。待機中の問い直し・上限・取り消しを確かめる。
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LearnedMemoryLink } from "./learned-memory-link";

import type { AnyRootRoute } from "@tanstack/react-router";

const okJson = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const stubLearned = (bodies: unknown[]) => {
  const responses = [...bodies];
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    calls.push(String(input));
    const next = responses.length > 1 ? responses.shift() : responses[0];
    return okJson(next);
  });
  return calls;
};

const renderLink = async (turn = 7) => {
  const root = createRootRoute({ component: () => <Outlet /> });
  const children = [
    createRoute({
      getParentRoute: (): AnyRootRoute => root,
      path: "/",
      component: () => (
        <LearnedMemoryLink characterId="char-1" conversationId="conv-1" turn={turn} />
      ),
    }),
    createRoute({
      getParentRoute: (): AnyRootRoute => root,
      path: "/chat/$id/memory",
      component: () => <p>memory</p>,
    }),
  ];
  const router = createRouter({
    routeTree: root.addChildren(children),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(<RouterProvider router={router} />);
  // 起動時の問い合わせ（microtask）を吐き出させるだけ。router.load を待つと
  // fake timer 環境で解決しない約束に引っかかる。
  await act(async () => {});
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("LearnedMemoryLink", () => {
  it("done で記憶があれば「覚えた：本文」のリンクを出す", async () => {
    stubLearned([{ state: "done", memories: [{ id: "m1", content: "紅茶が好き" }] }]);
    await renderLink();
    const link = await screen.findByRole("link", { name: /覚えた：紅茶が好き/ });
    expect(link).toHaveAttribute("href", "/chat/char-1/memory?conversationId=conv-1");
  });

  it("none・failed・記憶なしでは何も出さん", async () => {
    stubLearned([{ state: "none", memories: [] }]);
    await renderLink();
    await waitFor(() => expect(screen.queryByRole("link")).toBeNull());
    stubLearned([{ state: "failed", memories: [] }]);
    cleanup();
    await renderLink();
    await waitFor(() => expect(screen.queryByRole("link")).toBeNull());
    stubLearned([{ state: "done", memories: [] }]);
    cleanup();
    await renderLink();
    await waitFor(() => expect(screen.queryByRole("link")).toBeNull());
  });

  it("pending は 3 秒ごとに問い直し、done になれば出す", async () => {
    vi.useFakeTimers();
    const calls = stubLearned([
      { state: "pending", memories: [] },
      { state: "pending", memories: [] },
      { state: "done", memories: [{ id: "m1", content: "猫が好き" }] },
    ]);
    await renderLink();
    expect(screen.queryByRole("link")).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    // fake timer 中は findBy（内部が setTimeout で見回す）が進まんので同期照会にする
    expect(screen.getByRole("link", { name: /覚えた：猫が好き/ })).toBeInTheDocument();
    expect(calls).toHaveLength(3);
  });

  it("pending が続いても 10 回で打ち切る", async () => {
    vi.useFakeTimers();
    const calls = stubLearned([{ state: "pending", memories: [] }]);
    await renderLink();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(calls.length).toBeLessThanOrEqual(10);
    expect(calls.length).toBeGreaterThanOrEqual(10);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("通信に失敗してもリンクは出ず、画面は止まらん", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    await renderLink();
    // 例外は中で握りつぶされ、リンクは出ない
    await waitFor(() => expect(screen.queryByRole("link")).toBeNull());
  });
});
