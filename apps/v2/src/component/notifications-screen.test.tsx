// 通知の設定（板 Notifications）。許可ゲート・切替の保存と失敗時の巻き戻し・
// 文のプレビュー・「話しかけてくる子」・骨組み/読み込み失敗を確かめる。
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

import {
  NotificationsErrorState,
  NotificationsLoadingState,
  NotificationsScreen,
  type NotificationChild,
  type NotifySettings,
} from "./notifications-screen";

import type { AnyRootRoute } from "@tanstack/react-router";

const BASE: NotifySettings = {
  enabled: true,
  proactive: true,
  feed: true,
  call: true,
  anniversary: true,
  hideText: true,
};

const CHILD: NotificationChild = {
  id: "char-suzu",
  name: "霜月 鈴",
  avatar: null,
  enabled: true,
};

// subscribeToPush は許可・購読の結果をこの差し替えで返す。
const push = vi.hoisted(() => ({ result: "subscribed" as string }));
vi.mock("../lib/push", () => ({
  subscribeToPush: async () => push.result,
}));

// ブラウザの通知許可を Notification.permission で差し替える。
const stubPermission = (permission: "granted" | "default" | "denied" | "unsupported") => {
  vi.stubGlobal("PushManager", class {});
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: permission === "unsupported" ? undefined : {},
  });
  vi.stubGlobal("Notification", { permission });
};

const renderWithRouter = async (node: React.ReactNode) => {
  const root = createRootRoute({ component: () => <Outlet /> });
  const children = [
    createRoute({
      getParentRoute: (): AnyRootRoute => root,
      path: "/notifications",
      component: () => node,
    }),
    createRoute({
      getParentRoute: (): AnyRootRoute => root,
      path: "/my",
      component: () => <p>my</p>,
    }),
    createRoute({
      getParentRoute: (): AnyRootRoute => root,
      path: "/catalog",
      component: () => <p>catalog</p>,
    }),
  ];
  const router = createRouter({
    routeTree: root.addChildren(children),
    history: createMemoryHistory({ initialEntries: ["/notifications"] }),
  });
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(screen.getByRole("link", { name: "戻る" })).toBeInTheDocument());
};

const renderScreen = (settings = BASE, children: NotificationChild[] = [CHILD]) =>
  renderWithRouter(<NotificationsScreen settings={settings} characters={children} />);

const stubPut = (impl: (body: Record<string, unknown>, url: string) => Promise<boolean>) => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ url, body });
    const ok = await impl(body, url);
    return new Response("{}", { status: ok ? 200 : 500 });
  });
  return calls;
};

const masterSwitch = () => screen.getByRole("switch", { name: "通知を受け取る" });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  push.result = "subscribed";
});

describe("許可ゲート（板の3帯）", () => {
  it("許可がある時は全項目を出す", async () => {
    stubPermission("granted");
    await renderScreen();
    expect(masterSwitch().getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("下で選んだものだけが届きます。")).toBeInTheDocument();
    expect(screen.getByText("届くもの")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "話しかけ" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "つぶやき・日記" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "電話の約束" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "おぼえている日" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "通知の文を隠す" })).toBeInTheDocument();
    expect(screen.getByText("話しかけてくる子")).toBeInTheDocument();
  });

  it("はじめてオンにする前は許可の案内で切のまま", async () => {
    stubPermission("default");
    await renderScreen({ ...BASE, enabled: false });
    expect(masterSwitch().getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText(/オンにすると、スマホから許可を聞かれます/)).toBeInTheDocument();
    expect(screen.queryByText("届くもの")).toBeNull();
  });

  it("許可が拒否されている時は止められている案内", async () => {
    stubPermission("denied");
    await renderScreen();
    expect(masterSwitch().getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText(/通知が止められています/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /もう一度/ })).toBeInTheDocument();
  });

  it("未対応の時はホーム画面に追加の案内と「追加のしかた」", async () => {
    stubPermission("unsupported");
    await renderScreen();
    expect(screen.getByText(/ホーム画面に追加すると、受け取れます/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "追加のしかた" }));
    expect(screen.getByRole("dialog", { name: "ホーム画面に追加" })).toBeInTheDocument();
    expect(screen.getByText("燈をひらく")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("切から押すと許可を求め、通れば入になる", async () => {
    stubPermission("default");
    const calls = stubPut(async () => true);
    await renderScreen({ ...BASE, enabled: false });
    fireEvent.click(masterSwitch());
    await waitFor(() => expect(masterSwitch().getAttribute("aria-checked")).toBe("true"));
    expect(calls.some((call) => call.body.notifyEnabled === true)).toBe(true);
  });

  it("許可を拒否されたら切のまま止められている案内になる", async () => {
    stubPermission("default");
    push.result = "denied";
    stubPut(async () => true);
    await renderScreen({ ...BASE, enabled: false });
    fireEvent.click(masterSwitch());
    await waitFor(() => expect(screen.getByText(/通知が止められています/)).toBeInTheDocument());
    expect(masterSwitch().getAttribute("aria-checked")).toBe("false");
  });
});

describe("切替の保存と失敗（板「切り替えを保存できなかった時」）", () => {
  it("項目ごとに PUT され、失敗すると元に戻り「もう一度」で再送する", async () => {
    stubPermission("granted");
    let fail = true;
    const calls = stubPut(async () => !fail);
    await renderScreen();
    const row = screen.getByRole("switch", { name: "通知の文を隠す" });
    fireEvent.click(row);
    await waitFor(() => expect(screen.getByText(/保存できませんでした/)).toBeInTheDocument());
    expect(calls).toEqual([{ url: "/api/settings", body: { notifyHideText: false } }]);
    // 失敗したのでスイッチは元（入）に戻る。
    expect(row.getAttribute("aria-checked")).toBe("true");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "もう一度" }));
    await waitFor(() => expect(row.getAttribute("aria-checked")).toBe("false"));
    expect(calls).toHaveLength(2);
  });

  it("プレビューは隠す時は汎用、出す時は子の名と文", async () => {
    stubPermission("granted");
    stubPut(async () => true);
    await renderScreen();
    expect(screen.getByText("新しいメッセージがあります")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "通知の文を隠す" }));
    await waitFor(() =>
      expect(screen.getByText("「…起きてる？ 鍵、開けといた」")).toBeInTheDocument(),
    );
    expect(
      within(screen.getByText("いま").parentElement!.parentElement!).getByText("霜月 鈴"),
    ).toBeInTheDocument();
  });
});

describe("話しかけてくる子", () => {
  it("いない時は板の空の案内と「出会うへ」", async () => {
    stubPermission("granted");
    await renderScreen(BASE, []);
    expect(screen.getByText("まだ、話した子はいません")).toBeInTheDocument();
    expect(screen.getByText("話した子が、ここに並びます。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "出会うへ" })).toBeInTheDocument();
  });

  it("子の切替はキャラごとの settings へ PUT する", async () => {
    stubPermission("granted");
    const calls = stubPut(async () => true);
    await renderScreen();
    const row = screen.getByRole("switch", { name: "霜月 鈴から話しかける" });
    expect(row.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(row);
    await waitFor(() => expect(row.getAttribute("aria-checked")).toBe("false"));
    expect(calls).toEqual([
      {
        url: "/api/proactive/characters/char-suzu/settings",
        body: { enabled: false },
      },
    ]);
  });
});

describe("読み込み中・失敗", () => {
  it("骨組みと失敗の形を出す", async () => {
    stubPermission("granted");
    await renderWithRouter(<NotificationsLoadingState />);
    expect(screen.getByRole("status", { name: "読み込んでいます" })).toBeInTheDocument();
    expect(screen.queryByText("通知を受け取る")).toBeNull();
    cleanup();
    const retry = vi.fn();
    await renderWithRouter(<NotificationsErrorState onRetry={retry} />);
    expect(screen.getByText("通知の設定を読み込めませんでした。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "もう一度" }));
    expect(retry).toHaveBeenCalled();
  });
});
