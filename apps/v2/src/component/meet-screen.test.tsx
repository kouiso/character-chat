// 出会う（板 Meet・MeetList・MeetEmpty）。デッキの操作（飛ばす・元に戻す・とっておく）、
// 一覧の札・見たい子・名前さがし、空の状態を板どおりに出せることを確かめる。
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { MeetScreen } from "./meet-screen";

import type { AnyRootRoute } from "@tanstack/react-router";
import type { MeetCharacter } from "../server/api-meet";

const meet = (over: Partial<MeetCharacter> = {}): MeetCharacter => ({
  id: crypto.randomUUID(),
  name: "鈴",
  avatar: null,
  greeting: "今夜ひま？",
  tags: ["幼なじみ", "甘々", "同棲"],
  official: false,
  own: true,
  lastTalkedAt: null,
  keptAt: null,
  ...over,
});

const renderScreen = async (items: MeetCharacter[]) => {
  const root = createRootRoute({ component: () => <Outlet /> });
  const children = [
    createRoute({
      getParentRoute: (): AnyRootRoute => root,
      path: "/",
      component: () => <MeetScreen items={items} />,
    }),
    createRoute({
      getParentRoute: (): AnyRootRoute => root,
      path: "/characters/$id",
      component: () => <p>profile</p>,
    }),
    createRoute({
      getParentRoute: (): AnyRootRoute => root,
      path: "/characters/new",
      component: () => <p>new</p>,
    }),
    createRoute({
      getParentRoute: (): AnyRootRoute => root,
      path: "/chat/$id",
      component: () => <p>chat</p>,
    }),
  ];
  const router = createRouter({
    routeTree: root.addChildren(children),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const rendered = render(<RouterProvider router={router} />);
  await waitFor(() => expect(screen.getByText("出会う")).toBeInTheDocument());
  return rendered;
};

// jsdom は pointer capture も PointerEvent も持たんので、ドラッグ試験の前に
// 空の身代わりを足し、座標つきの出来事は MouseEvent で投げる
beforeAll(() => {
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
});

const firePointer = (el: Element, type: string, clientX: number) => {
  act(() => {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX }));
  });
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("出会う（デッキ）", () => {
  it("名前・状態・セリフ・札・操作を板どおり出す", async () => {
    const item = meet({ name: "鈴" });
    await renderScreen([item]);
    expect(screen.getByRole("heading", { name: "鈴" })).toBeInTheDocument();
    expect(screen.getByText("起きてる")).toBeInTheDocument();
    expect(screen.getByText("つくった子")).toBeInTheDocument();
    expect(screen.getByText("「今夜ひま？」")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "鈴のプロフィール" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "鈴を飛ばす" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "鈴をとっておく" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "鈴と話す" })).toBeInTheDocument();
    // 見え方の切替（板のアクセシビリティ名）
    expect(screen.getByRole("button", { name: "1 人ずつ見る" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "一覧で見る" })).toBeInTheDocument();
  });

  it("初めての時だけ「左右に送れます」を出す", async () => {
    await renderScreen([meet()]);
    expect(screen.getByText("左右に送れます")).toBeInTheDocument();
    localStorage.setItem("v2-meet-swipe-hint", "1");
    cleanup();
    await renderScreen([meet()]);
    expect(screen.queryByText("左右に送れます")).not.toBeInTheDocument();
  });

  it("左右に引くと向きの印が出て、閾値を超えると送る", async () => {
    const { container } = await renderScreen([meet({ name: "鈴" }), meet({ name: "茜" })]);
    const stage = container.querySelector(".v2-meet-stage");
    if (!stage) throw new Error("stage not found");
    // 右へ引く → とっておくの印
    firePointer(stage, "pointerdown", 195);
    firePointer(stage, "pointermove", 260);
    expect(container.querySelector(".v2-meet-stamp.keep")).not.toBeNull();
    firePointer(stage, "pointermove", 120);
    expect(container.querySelector(".v2-meet-stamp.skip")).not.toBeNull();
    // 閾値を超えて離す → 飛ばす
    firePointer(stage, "pointerup", 110);
    expect(await screen.findByText("飛ばしました")).toBeInTheDocument();
    // 短い引きは戻る（鈴は送ったあとなので、先頭は茜のまま）
    firePointer(stage, "pointerdown", 195);
    firePointer(stage, "pointermove", 215);
    firePointer(stage, "pointerup", 215);
    expect(screen.getByRole("button", { name: "茜を飛ばす" })).toBeInTheDocument();
  });

  it("飛ばすと次の子に進み、元に戻すで戻れる", async () => {
    await renderScreen([meet({ name: "鈴" }), meet({ name: "茜" })]);
    fireEvent.click(screen.getByRole("button", { name: "鈴を飛ばす" }));
    expect(await screen.findByText("飛ばしました")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "元に戻す" }));
    expect(await screen.findByRole("button", { name: "鈴を飛ばす" })).toBeInTheDocument();
  });

  it("最後まで送ると空の状態と「はじめから見る」を出す", async () => {
    await renderScreen([meet({ name: "鈴" })]);
    fireEvent.click(screen.getByRole("button", { name: "鈴を飛ばす" }));
    expect(await screen.findByText("ひととおり会いました")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "はじめから見る" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "自分でつくる" })).toBeInTheDocument();
  });

  it("とっておくとAPIを呼び、知らせと「とっておいた子を見る」を出す", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${String(input)}`);
      return new Response("{}", { status: 200 });
    });
    const item = meet({ name: "鈴" });
    await renderScreen([item]);
    fireEvent.click(screen.getByRole("button", { name: "鈴をとっておく" }));
    expect(await screen.findByText("とっておきました")).toBeInTheDocument();
    await waitFor(() => expect(calls).toContain(`PUT /api/characters/${item.id}/keep`));
    fireEvent.click(screen.getByRole("button", { name: "とっておいた子を見る" }));
    // 一覧に切り替わり「とっておいた子」が選ばれている
    expect(await screen.findByRole("button", { name: /いまはとっておいた子/ })).toBeInTheDocument();
  });

  it("とっておけない時は知らせを出す", async () => {
    vi.stubGlobal("fetch", async () => new Response("x", { status: 500 }));
    await renderScreen([meet({ name: "鈴" })]);
    fireEvent.click(screen.getByRole("button", { name: "鈴をとっておく" }));
    expect(await screen.findByText("この子をとっておけませんでした")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "もう一度" })).toBeInTheDocument();
  });

  it("読み込んだ keptAt は一覧の「とっておいた子」に出る", async () => {
    const kept = meet({ name: "鈴", keptAt: Date.now() });
    await renderScreen([kept]);
    fireEvent.click(screen.getByRole("button", { name: "一覧で見る" }));
    const want = await screen.findByRole("button", { name: /見たい子を選ぶ/ });
    fireEvent.click(want);
    const dialog = await screen.findByRole("dialog", { name: "見たい子" });
    fireEvent.click(within(dialog).getByRole("button", { name: /とっておいた子/ }));
    expect(await screen.findByRole("link", { name: "鈴のプロフィール" })).toBeInTheDocument();
  });
});

describe("出会う（一覧）", () => {
  it("札・見たい子・さがすの導線と 2 列の札付きカードを出す", async () => {
    await renderScreen([
      meet({ name: "鈴", lastTalkedAt: Date.now() }),
      meet({ name: "茜", official: true, own: false }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "一覧で見る" }));
    expect(await screen.findByRole("group", { name: "状況・関係で絞る" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "相手の態度で絞る" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /見たい子を選ぶ/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "名前でさがす" })).toBeInTheDocument();
    expect(screen.getByText("話したことがある")).toBeInTheDocument();
  });

  it("名前でさがすと絞れる。合う子がいない時は空の状態を出す", async () => {
    await renderScreen([meet({ name: "鈴" }), meet({ name: "茜" })]);
    fireEvent.click(screen.getByRole("button", { name: "一覧で見る" }));
    fireEvent.click(await screen.findByRole("button", { name: "名前でさがす" }));
    const input = screen.getByRole("textbox", { name: "名前でさがす" });
    fireEvent.change(input, { target: { value: "鈴" } });
    expect(screen.getByRole("link", { name: "鈴のプロフィール" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "茜のプロフィール" })).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: "ななし" } });
    expect(await screen.findByText("「ななし」に合う子は、まだいません")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "「ななし」のままつくる" })).toBeInTheDocument();
  });

  it("札で絞れて、外せば全部に戻る", async () => {
    await renderScreen([
      meet({ name: "鈴", tags: ["幼なじみ", "同棲"] }),
      meet({ name: "茜", tags: ["同僚", "職場"] }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "一覧で見る" }));
    fireEvent.click(await screen.findByRole("button", { name: "職場" }));
    expect(screen.getByRole("link", { name: "茜のプロフィール" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "鈴のプロフィール" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "職場" }));
    expect(await screen.findByRole("link", { name: "鈴のプロフィール" })).toBeInTheDocument();
  });

  it("見たい子シートで「公式の子」に絞れる", async () => {
    await renderScreen([
      meet({ name: "鈴", own: true }),
      meet({ name: "茜", official: true, own: false }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "一覧で見る" }));
    fireEvent.click(await screen.findByRole("button", { name: /見たい子を選ぶ/ }));
    const dialog = await screen.findByRole("dialog", { name: "見たい子" });
    fireEvent.click(within(dialog).getByRole("button", { name: "公式の子" }));
    expect(screen.getByRole("link", { name: "茜のプロフィール" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "鈴のプロフィール" })).not.toBeInTheDocument();
  });

  it("とっておいた子がいない時は空の状態と「1 人ずつ見る」を出す", async () => {
    await renderScreen([meet({ name: "鈴" })]);
    fireEvent.click(screen.getByRole("button", { name: "一覧で見る" }));
    fireEvent.click(await screen.findByRole("button", { name: /見たい子を選ぶ/ }));
    const dialog = await screen.findByRole("dialog", { name: "見たい子" });
    fireEvent.click(within(dialog).getByRole("button", { name: /とっておいた子/ }));
    expect(await screen.findByText("まだ、とっておいた子はいません")).toBeInTheDocument();
    // 空の状態の「1 人ずつ見る」（見え方トグルにも同名があるので aria-pressed の無い側を押す）
    const singles = screen
      .getAllByRole("button", { name: "1 人ずつ見る" })
      .filter((button) => button.getAttribute("aria-pressed") === null);
    expect(singles).toHaveLength(1);
    fireEvent.click(singles[0]);
    expect(await screen.findByRole("button", { name: "鈴を飛ばす" })).toBeInTheDocument();
  });
});
