// 記憶の画面（RIT-92）。板の状態（空・骨組み・失敗・節・ほか N 件・各シート）を
// fetch を置き換えて確かめる。
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MemoryScreen } from "./memory-screen";

import type { AnyRootRoute } from "@tanstack/react-router";

const now = Date.now();
const memory = (over: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(),
  conversationId: "conv-1",
  kind: "fact",
  category: "long",
  content: "紅茶が好き",
  pinned: false,
  origin: "extracted",
  editedAt: null,
  createdAt: now - 3 * 86_400_000,
  supersededBy: null,
  usedInLastReply: false,
  revision: 1,
  ...over,
});

const listBody = (memories: unknown[] = []) => ({
  conversationId: "conv-1",
  characterName: "鈴",
  memories,
});

const okJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// 呼ばれた URL・メソッド・body を記録する fetch の身代わり。
const stubFetch = (handler: (input: RequestInfo | URL, init?: RequestInit) => Response) => {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return handler(input, init);
  });
  return calls;
};

const renderScreen = async () => {
  const root = createRootRoute({ component: () => <Outlet /> });
  const children = [
    createRoute({
      getParentRoute: (): AnyRootRoute => root,
      path: "/",
      component: () => (
        <MemoryScreen characterId="char-1" characterName="鈴" conversationId="conv-1" />
      ),
    }),
    createRoute({
      getParentRoute: (): AnyRootRoute => root,
      path: "/chat/$id",
      component: () => <p>chat</p>,
    }),
    createRoute({
      getParentRoute: (): AnyRootRoute => root,
      path: "/chat/$id/memory",
      component: () => <p>memory route</p>,
    }),
  ];
  const router = createRouter({
    routeTree: root.addChildren(children),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(screen.getByRole("heading", { name: "記憶" })).toBeInTheDocument());
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MemoryScreen", () => {
  it("空の時は案内と「記憶を足す」を出す", async () => {
    stubFetch(() => okJson(listBody()));
    await renderScreen();
    expect(await screen.findByText("まだ、記憶はありません")).toBeInTheDocument();
    expect(screen.getByText(/鈴が覚えた事が/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "記憶を足す" })).not.toHaveLength(0);
  });

  it("読み込みに失敗すると文言ともう一度を出し、押すと読み直す", async () => {
    let calls = 0;
    stubFetch(() => {
      calls += 1;
      return calls === 1 ? new Response("x", { status: 500 }) : okJson(listBody());
    });
    await renderScreen();
    expect(await screen.findByText("記憶を読み込めませんでした。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "もう一度" }));
    await waitFor(() => expect(calls).toBe(2));
  });

  it("節・本文・印・導入文を板どおり出す", async () => {
    stubFetch(() =>
      okJson(
        listBody([
          memory({ content: "固定の記憶", pinned: true, category: "long" }),
          memory({
            content: "直した記憶",
            editedAt: now - 1000,
            category: "recent",
            origin: "manual",
            createdAt: now - 4 * 86_400_000,
          }),
          memory({ content: "使った記憶", usedInLastReply: true, category: "relation" }),
          memory({ content: "新しい記憶", createdAt: now, category: "future" }),
        ]),
      ),
    );
    await renderScreen();
    expect(
      await screen.findByText("鈴が会話から覚えた事です。違っていたら、押して書き換えられます。"),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "長く覚える事" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "さいきんの事" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "ふたりの関係" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "これからの事" })).toBeInTheDocument();
    expect(screen.getByText("固定")).toBeInTheDocument();
    expect(screen.getByText("自分で直した")).toBeInTheDocument();
    expect(screen.getByText("さっきの返事で使った")).toBeInTheDocument();
    expect(screen.getByText("新着")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "もっと（記憶の削除）" })).toBeInTheDocument();
  });

  it("同じ節に4件を超えると「ほか N 件を見る」で開く", async () => {
    stubFetch(() =>
      okJson(
        listBody(
          Array.from({ length: 6 }, (_, index) =>
            memory({ content: `記憶${index}`, createdAt: now - index * 1000 }),
          ),
        ),
      ),
    );
    await renderScreen();
    expect(await screen.findByText("記憶2")).toBeInTheDocument();
    expect(screen.queryByText("記憶3")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "ほか 3 件を見る" }));
    expect(await screen.findByText("記憶3")).toBeInTheDocument();
    expect(screen.getByText("記憶5")).toBeInTheDocument();
  });

  it("行を押すと書き換えシートが開き、保存すると PATCH を expectedRevision 付きで呼ぶ", async () => {
    const row = memory({ content: "直す前の記憶" });
    const calls = stubFetch((_input, init) => {
      if (init?.method === "PATCH") {
        return okJson({ memory: { ...row, content: "直した後", editedAt: now, revision: 2 } });
      }
      return okJson(listBody([row]));
    });
    await renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: /直す前の記憶/ }));
    const sheet = await screen.findByRole("dialog", { name: "記憶を書き換える" });
    const textarea = sheet.querySelector("textarea");
    expect(textarea).toHaveValue("直す前の記憶");
    fireEvent.change(textarea!, { target: { value: "直した後" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(
        calls.find(
          (call) =>
            call.method === "PATCH" &&
            (call.body as { expectedRevision?: number }).expectedRevision === 1,
        ),
      ).toBeTruthy(),
    );
    expect(await screen.findByText("記憶を書き換えました")).toBeInTheDocument();
    expect(screen.getByText("直した後")).toBeInTheDocument();
  });

  it("保存に失敗すると文は残し、失敗の文言を出す", async () => {
    const row = memory({ content: "直す前の記憶" });
    stubFetch((_input, init) => {
      if (init?.method === "PATCH") {
        return new Response(JSON.stringify({ code: "unavailable", message: "x" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        });
      }
      return okJson(listBody([row]));
    });
    await renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: /直す前の記憶/ }));
    const textarea = await screen.findByDisplayValue("直す前の記憶");
    fireEvent.change(textarea, { target: { value: "書き換えた内容" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText("記憶を保存できませんでした。")).toBeInTheDocument();
    expect(screen.getByDisplayValue("書き換えた内容")).toBeInTheDocument();
  });

  it("記憶を足すと POST を呼び、知らせを出す", async () => {
    const added = memory({ content: "手で足した記憶", origin: "manual", pinned: true });
    const calls = stubFetch((_input, init) => {
      if (init?.method === "POST") return okJson({ memory: added }, 201);
      return okJson(listBody([added]));
    });
    await renderScreen();
    await screen.findByText("手で足した記憶");
    fireEvent.click(screen.getByRole("button", { name: "記憶を足す" }));
    const sheet = await screen.findByRole("dialog", { name: "記憶を足す" });
    const textarea = within(sheet).getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "手で足した記憶" } });
    fireEvent.click(within(sheet).getByRole("radio", { name: "ふたり" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "記憶を足す" }));
    await waitFor(() => {
      const post = calls.find((call) => call.method === "POST");
      expect(post).toBeTruthy();
      expect(post!.body).toMatchObject({ content: "手で足した記憶", category: "relation" });
    });
    expect(await screen.findByText("記憶を足しました")).toBeInTheDocument();
  });

  it("削除は確かめのあと消え、元に戻すで復元を呼ぶ", async () => {
    const row = memory({ content: "消す記憶" });
    const calls = stubFetch((_input, init) => {
      if (init?.method === "DELETE") return okJson({ ok: true, deletedAt: now });
      if (init?.method === "POST") return okJson({ memory: row });
      return okJson(listBody([row]));
    });
    await renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: /消す記憶/ }));
    fireEvent.click(await screen.findByRole("button", { name: "この記憶を削除" }));
    fireEvent.click(await screen.findByRole("button", { name: "削除する" }));
    await waitFor(() => expect(calls.find((call) => call.method === "DELETE")).toBeTruthy());
    expect(await screen.findByText("記憶を削除しました")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "元に戻す" }));
    await waitFor(() =>
      expect(
        calls.find((call) => call.method === "POST" && call.url.includes("/restore")),
      ).toBeTruthy(),
    );
  });
});
