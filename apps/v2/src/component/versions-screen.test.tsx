// 版の履歴（板 Versions）。版の選択・中身の表示・戻す確かめ・失敗の全面形を確かめる。
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { characterContentSchema } from "@v2/db/character-version";
import { afterEach, describe, expect, it, vi } from "vitest";

import { VersionsScreen, type VersionsRow } from "./versions-screen";

import type { AnyRootRoute } from "@tanstack/react-router";

const CHARACTER = { id: "char-1", name: "さくら", revision: 5, ownerUserId: "local" };

const V1 = { id: "v1", version: 1, createdAt: new Date(2026, 10, 2, 0, 41).getTime() };
const V2 = { id: "v2", version: 2, createdAt: new Date(2026, 10, 5, 23, 12).getTime() };
const V3 = { id: "v3", version: 3, createdAt: new Date(2026, 10, 7, 21, 30).getTime() };

const versions: VersionsRow[] = [V3, V2, V1];

const content = characterContentSchema.parse({
  name: "さくら",
  bio: "カフェの店員",
  personality: "明るくて聞き上手。",
  speechStyle: "やわらかい話し方。",
  greeting: "「いらっしゃい」",
  prologue: "閉店まぎわのカフェ。",
  appearance: "茶色の髪",
  background: "店の鍵を預かっている。",
  worldSetting: "いまの東京。",
  privateNotes: "閉店の札を少し待つ。",
  memoryInstruction: "",
  memoryKinds: ["fact", "preference"],
  tags: ["再会", "甘々"],
});

const renderWithRouter = async (node: React.ReactNode) => {
  const root = createRootRoute({ component: () => <Outlet /> });
  const children = [
    createRoute({
      getParentRoute: (): AnyRootRoute => root,
      path: "/characters/$id/versions",
      component: () => node,
    }),
    createRoute({
      getParentRoute: (): AnyRootRoute => root,
      path: "/characters/$id",
      component: () => <p>edit</p>,
    }),
    createRoute({
      getParentRoute: (): AnyRootRoute => root,
      path: "/chat/$id",
      component: () => <p>chat</p>,
    }),
  ];
  const router = createRouter({
    routeTree: root.addChildren(children),
    history: createMemoryHistory({ initialEntries: ["/characters/char-1/versions"] }),
  });
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(screen.getByRole("link", { name: "戻る" })).toBeInTheDocument());
};

const stubDetail = (status = 200) => {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const hit = /\/versions\/([^/]+)$/.exec(url);
    if (hit) {
      return status === 200
        ? Response.json({
            id: hit[1],
            version: 1,
            createdAt: V1.createdAt,
            content,
          })
        : new Response("{}", { status });
    }
    return new Response("{}", { status: 500 });
  });
  return calls;
};

const renderScreen = (props?: { currentVersionId?: string | null; rows?: VersionsRow[] }) =>
  renderWithRouter(
    <VersionsScreen
      character={CHARACTER}
      currentVersionId={props?.currentVersionId ?? V3.id}
      versions={props?.rows ?? versions}
    />,
  );

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("VersionsScreen", () => {
  it("古い版を選ぶと中身を読んで欄ごとに出し、戻すボタンが出る", async () => {
    stubDetail();
    await renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "11月2日 0:41の設定を見る" }));
    const detail = await screen.findByRole("region", { name: "11月2日の設定" });
    expect(within(detail).getByText("カフェの店員")).toBeInTheDocument();
    expect(within(detail).getByText("明るくて聞き上手。")).toBeInTheDocument();
    expect(within(detail).getByText("事実、好み")).toBeInTheDocument();
    // 紹介・始まり方・絵の見た目・何を覚えるかは空欄（板どおり「入っていません」）。
    expect(within(detail).getAllByText("入っていません").length).toBeGreaterThanOrEqual(4);
    expect(screen.getByRole("button", { name: "この設定に戻す" })).toBeInTheDocument();
  });

  it("いまを選ぶと中身は出さず「いまの設定です」になる", async () => {
    stubDetail();
    await renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "11月7日 21:30の設定を見る" }));
    expect(screen.getByText("いまの設定です。戻す必要はありません。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "この設定に戻す" })).not.toBeInTheDocument();
  });

  it("版が現行だけなら「前の設定は、まだありません。」", async () => {
    await renderScreen({ rows: [V3], currentVersionId: V3.id });
    expect(screen.getByText("前の設定は、まだありません。")).toBeInTheDocument();
  });

  it("戻す→確かめ→POST restore→知らせが出る", async () => {
    const calls = stubDetail();
    await renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "11月2日 0:41の設定を見る" }));
    fireEvent.click(await screen.findByRole("button", { name: "この設定に戻す" }));
    const sheet = await screen.findByRole("alertdialog");
    expect(within(sheet).getByText("11月2日の設定に戻しますか？")).toBeInTheDocument();
    calls.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init });
        if (init?.method === "POST")
          return Response.json({ id: "char-1", revision: 6, versionId: "v4" });
        // 戻したあとの選択は新版 v4。props が変わるまでの読みに中身を返す。
        return Response.json({ id: "v4", version: 4, createdAt: V3.createdAt, content });
      }),
    );
    fireEvent.click(within(sheet).getByRole("button", { name: "戻す" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("前の設定に戻しました"),
    );
    expect(calls[0].url).toBe("/api/characters/char-1/restore");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      versionId: "v1",
      expectedRevision: 5,
    });
    expect(screen.getByRole("link", { name: "新しい会話を始める" })).toBeInTheDocument();
  });

  it("戻せなかった時は全面の失敗形になり「もう一度」で同じ戻しをやり直す", async () => {
    stubDetail();
    await renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "11月2日 0:41の設定を見る" }));
    fireEvent.click(await screen.findByRole("button", { name: "この設定に戻す" }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 503 })),
    );
    const sheet = await screen.findByRole("alertdialog");
    fireEvent.click(within(sheet).getByRole("button", { name: "戻す" }));
    expect(await screen.findByText("前の設定に戻せませんでした。")).toBeInTheDocument();
    const retry = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST")
        return Response.json({ id: "char-1", revision: 6, versionId: "v4" });
      return Response.json({ id: "v4", version: 4, createdAt: V3.createdAt, content });
    });
    vi.stubGlobal("fetch", retry);
    fireEvent.click(screen.getByRole("button", { name: "もう一度" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("前の設定に戻しました"),
    );
    expect(JSON.parse(String(retry.mock.calls[0][1]?.body))).toEqual({
      versionId: "v1",
      expectedRevision: 5,
    });
  });

  it("版の中身が 404 なら「この設定が見つかりませんでした。」", async () => {
    // 開いた時点で先に選ばれる古い版（v2）の中身が無い形。
    stubDetail(404);
    await renderScreen();
    expect(await screen.findByText("この設定が見つかりませんでした。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "編集に戻る" })).toBeInTheDocument();
  });

  it("版の中身が読めない時は「もう一度」で読み直す", async () => {
    stubDetail(500);
    await renderScreen();
    expect(await screen.findByText("この設定の中身を読み込めませんでした。")).toBeInTheDocument();
    stubDetail();
    fireEvent.click(screen.getByRole("button", { name: "もう一度" }));
    expect(await screen.findByText("カフェの店員")).toBeInTheDocument();
  });

  it("版が多い時は 5 行まで「もっと前を見る」で全部出す", async () => {
    stubDetail();
    const many: VersionsRow[] = Array.from({ length: 7 }, (_, i) => ({
      id: `v${i + 1}`,
      version: i + 1,
      createdAt: V1.createdAt + i * 86_400_000,
    }));
    await renderScreen({ rows: many, currentVersionId: many[0].id });
    const group = screen.getByRole("group", { name: "前の設定" });
    expect(within(group).getAllByRole("button")).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: "もっと前を見る" }));
    expect(within(group).getAllByRole("button")).toHaveLength(7);
  });
});
