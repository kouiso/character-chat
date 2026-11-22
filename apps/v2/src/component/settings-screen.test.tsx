// 設定（板 Settings）。押してすぐ効く切替の見た目、楽観切替・失敗時の巻き戻しと
// 「もう一度」の再送、骨組み・読み込み失敗の形を板どおりに出せることを確かめる。
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
  SettingsErrorState,
  SettingsLoadingState,
  SettingsScreen,
  type UserSettings,
} from "./settings-screen";

import type { AnyRootRoute } from "@tanstack/react-router";

const BASE: UserSettings = {
  chatMode: "standard",
  style: "balanced",
  voiceAutoplay: false,
  handedness: "right",
};

const renderWithRouter = async (node: React.ReactNode) => {
  const root = createRootRoute({ component: () => <Outlet /> });
  const children = [
    createRoute({
      getParentRoute: (): AnyRootRoute => root,
      path: "/settings",
      component: () => node,
    }),
    createRoute({
      getParentRoute: (): AnyRootRoute => root,
      path: "/my",
      component: () => <p>my</p>,
    }),
  ];
  const router = createRouter({
    routeTree: root.addChildren(children),
    history: createMemoryHistory({ initialEntries: ["/settings"] }),
  });
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(screen.getByRole("link", { name: "戻る" })).toBeInTheDocument());
};

const renderScreen = (settings: UserSettings = BASE) =>
  renderWithRouter(<SettingsScreen settings={settings} />);

const stubSettingsPut = (impl: (body: Record<string, unknown>) => Promise<{ ok: boolean }>) => {
  const calls: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const result = await impl(calls[calls.length - 1]);
    return new Response("{}", { status: result.ok ? 200 : 500 });
  });
  return calls;
};

const stubSettingsPutThrow = () => {
  const calls: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    throw new TypeError("fetch failed");
  });
  return calls;
};

const selectedIn = (name: string) =>
  within(screen.getByRole("radiogroup", { name }))
    .getAllByRole("radio")
    .find((radio) => radio.getAttribute("aria-checked") === "true");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SettingsScreen（板 Settings）", () => {
  it("ふだん: 板の項目を順どおりに出し、いまの値が選ばれている", async () => {
    await renderScreen();

    expect(screen.getByRole("link", { name: "戻る" })).toBeInTheDocument();
    expect(screen.getByText("変えると、次の返事から、どの子にも効きます。")).toBeInTheDocument();

    const mode = screen.getByRole("radiogroup", { name: "返事の長さ" });
    expect(
      within(mode)
        .getAllByRole("radio")
        .map((r) => r.textContent),
    ).toEqual(["たっぷり", "ふつう", "短め"]);
    expect(selectedIn("返事の長さ")?.textContent).toBe("ふつう");

    const style = screen.getByRole("radiogroup", { name: "文体" });
    expect(
      within(style)
        .getAllByRole("radio")
        .map((r) => r.textContent),
    ).toEqual(["そのまま", "地の文重め", "会話重め"]);
    expect(selectedIn("文体")?.textContent).toBe("そのまま");

    const hand = screen.getByRole("radiogroup", { name: "持つ手" });
    expect(
      within(hand)
        .getAllByRole("radio")
        .map((r) => r.textContent),
    ).toEqual(["右", "左"]);
    expect(selectedIn("持つ手")?.textContent).toBe("右");

    expect(
      screen.getByRole("switch", { name: "声を自動で再生" }).getAttribute("aria-checked"),
    ).toBe("false");
    expect(screen.getByText("AI がおぼえた好み")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("選ぶと先に切り替わり、/api/settings へその項目だけ PUT する", async () => {
    const calls = stubSettingsPut(async () => ({ ok: true }));
    await renderScreen();

    fireEvent.click(screen.getByRole("radio", { name: "たっぷり" }));
    expect(selectedIn("返事の長さ")?.textContent).toBe("たっぷり");
    await waitFor(() => expect(calls).toEqual([{ chatMode: "quality" }]));

    fireEvent.click(screen.getByRole("switch", { name: "声を自動で再生" }));
    expect(
      screen.getByRole("switch", { name: "声を自動で再生" }).getAttribute("aria-checked"),
    ).toBe("true");
    await waitFor(() => expect(calls).toEqual([{ chatMode: "quality" }, { voiceAutoplay: true }]));
  });

  it("保存に失敗すると選びを元に戻し、その項目の下に「もう一度」を出す", async () => {
    const calls = stubSettingsPut(async () => ({ ok: false }));
    await renderScreen();

    fireEvent.click(screen.getByRole("radio", { name: "左" }));
    expect(selectedIn("持つ手")?.textContent).toBe("左");

    await waitFor(() =>
      expect(screen.getByText("保存できませんでした。前の設定のままです。")).toBeInTheDocument(),
    );
    expect(selectedIn("持つ手")?.textContent).toBe("右");
    // 失敗は持つ手の項目の下にだけ出る
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.queryByText("オフラインです。前の設定のままです。")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "もう一度" }));
    await waitFor(() => expect(calls).toEqual([{ handedness: "left" }, { handedness: "left" }]));
  });

  it("圏外の失敗はオフラインの文に替わる", async () => {
    const calls = stubSettingsPutThrow();
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await renderScreen();

    fireEvent.click(screen.getByRole("radio", { name: "会話重め" }));
    await waitFor(() =>
      expect(screen.getByText("オフラインです。前の設定のままです。")).toBeInTheDocument(),
    );
    expect(selectedIn("文体")?.textContent).toBe("そのまま");
    expect(calls).toEqual([{ style: "dialogue" }]);
    onLine.mockRestore();
  });

  it("新しい選択の途中で古い書き込みが失敗しても、新しい選びを巻き戻さない", async () => {
    // 「左」の書き込みだけ開いたままにして、あとから失敗させる。
    const deferred: { resolve: (v: { ok: boolean }) => void } = { resolve: () => {} };
    stubSettingsPut(
      (body) =>
        new Promise((resolve) => {
          if (body.handedness === "left") {
            deferred.resolve = resolve;
            return;
          }
          resolve({ ok: true });
        }),
    );
    await renderScreen();

    fireEvent.click(screen.getByRole("radio", { name: "左" }));
    fireEvent.click(screen.getByRole("radio", { name: "右" }));
    expect(selectedIn("持つ手")?.textContent).toBe("右");

    // 後から「左」の書き込みが失敗しても「右」の選びは残る
    deferred.resolve({ ok: false });
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(selectedIn("持つ手")?.textContent).toBe("右");
  });
});

describe("SettingsLoadingState / SettingsErrorState", () => {
  it("読み込み中は骨組みだけ（読み上げは「読み込んでいます」）", async () => {
    await renderWithRouter(<SettingsLoadingState />);
    expect(screen.getByRole("status", { name: "読み込んでいます" })).toBeInTheDocument();
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("読み込めなかった時は札＋「もう一度」で、押すとやり直す", async () => {
    const onRetry = vi.fn();
    await renderWithRouter(<SettingsErrorState onRetry={onRetry} />);
    expect(screen.getByText("設定を読み込めませんでした。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "もう一度" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
