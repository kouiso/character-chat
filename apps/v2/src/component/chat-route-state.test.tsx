import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Route as ChatRoute } from "../routes/chat/$id";

const { getCharacter } = vi.hoisted(() => ({ getCharacter: vi.fn() }));
vi.mock("../server/characters", () => ({ getCharacter }));

const fixture = { id: "synthetic-character", name: "合成テストキャラクター" };

const renderChat = () => {
  const root = createRootRoute({ component: Outlet });
  const home = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: () => <h1>合成一覧</h1>,
  });
  const chat = createRoute({ ...ChatRoute.options, getParentRoute: () => root, path: "/chat/$id" });
  const router = createRouter({
    routeTree: root.addChildren([home, chat]),
    history: createMemoryHistory({ initialEntries: ["/chat/synthetic-character"] }),
    defaultPendingMs: 0,
    defaultPendingMinMs: 0,
  });
  render(<RouterProvider router={router} />);
  return router;
};

const setOnline = (online: boolean) => {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: online });
  void act(() => window.dispatchEvent(new Event(online ? "online" : "offline")));
};

const expectBack = () => {
  const back = screen.getByRole("link", { name: "一覧に戻る" });
  expect(back).toHaveAttribute("href", "/");
  return back;
};

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  setOnline(true);
  getCharacter.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("chat route state exits", () => {
  it("待機中も戻れ、遅い完了で会話に引き戻されない", async () => {
    let resolveLoader: (value: typeof fixture) => void = () => {};
    getCharacter.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLoader = resolve;
        }),
    );
    const router = renderChat();
    await screen.findByRole("heading", { name: "会話を読み込んでいます" });
    expectBack();
    await act(() => router.navigate({ to: "/" }));
    expect(await screen.findByText("合成一覧")).toBeInTheDocument();
    await act(async () => {
      resolveLoader(fixture);
      await Promise.resolve();
    });
    expect(screen.queryByText(fixture.name)).not.toBeInTheDocument();
  });

  it("読み込み失敗から再試行し会話が表示される", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    getCharacter
      .mockRejectedValueOnce(new Error("synthetic-internal-detail"))
      .mockResolvedValue(fixture);
    renderChat();
    await screen.findByRole("heading", { name: "会話を読み込めませんでした" });
    expect(screen.queryByText("synthetic-internal-detail")).not.toBeInTheDocument();
    expectBack();
    fireEvent.click(screen.getByRole("button", { name: "読み込みをやり直す" }));
    expect(await screen.findByText(fixture.name)).toBeInTheDocument();
    expect(getCharacter).toHaveBeenCalledTimes(2);
  });

  it("再試行が繰り返し失敗しても出口が残る", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    getCharacter.mockRejectedValue(new Error("synthetic failure"));
    renderChat();
    await screen.findByRole("heading", { name: "会話を読み込めませんでした" });
    fireEvent.click(screen.getByRole("button", { name: "読み込みをやり直す" }));
    await screen.findByRole("heading", { name: "会話を読み込めませんでした" });
    expectBack();
    expect(screen.getByRole("button", { name: "読み込みをやり直す" })).toBeEnabled();
  });

  it("利用不能にも一覧への出口がある", async () => {
    getCharacter.mockResolvedValue(null);
    renderChat();
    await screen.findByRole("heading", { name: "このキャラクターは利用できません" });
    expectBack();
    expect(screen.queryByText(fixture.name)).not.toBeInTheDocument();
  });

  it("待機中の圏外・復帰でも出口が残る", async () => {
    getCharacter.mockImplementation(() => new Promise(() => {}));
    setOnline(false);
    renderChat();
    await screen.findByRole("heading", { name: "オフラインです" });
    expectBack();
    setOnline(true);
    expect(
      await screen.findByRole("heading", { name: "会話を読み込んでいます" }),
    ).toBeInTheDocument();
    expectBack();
    expect(getCharacter).toHaveBeenCalledTimes(1);
  });

  it("圏外の読み込み失敗からオンライン復帰後に手動で再試行できる", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    getCharacter.mockRejectedValueOnce(new Error("synthetic offline")).mockResolvedValue(fixture);
    setOnline(false);
    renderChat();
    await screen.findByRole("button", { name: "読み込みをやり直す" });
    expect(screen.getByRole("heading", { name: "オフラインです" })).toBeInTheDocument();
    expectBack();
    setOnline(true);
    expect(getCharacter).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "読み込みをやり直す" }));
    expect(await screen.findByText(fixture.name)).toBeInTheDocument();
  });

  it("会話表示中の圏外・復帰で入力を保ち自動送信しない", async () => {
    getCharacter.mockResolvedValue(fixture);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderChat();
    const input = await screen.findByPlaceholderText("メッセージを入力");
    fireEvent.change(input, { target: { value: "合成の未送信文" } });
    setOnline(false);
    expect(await screen.findByRole("heading", { name: "オフラインです" })).toBeInTheDocument();
    expectBack();
    expect(input).toHaveValue("合成の未送信文");
    setOnline(true);
    expect(screen.queryByRole("heading", { name: "オフラインです" })).not.toBeInTheDocument();
    expect(input).toHaveValue("合成の未送信文");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getCharacter).toHaveBeenCalledTimes(1);
  });

  it("生成待ちの既存表示にも押せる戻り先がある", async () => {
    getCharacter.mockResolvedValue(fixture);
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise(() => {}));
    renderChat();
    const input = await screen.findByPlaceholderText("メッセージを入力");
    fireEvent.change(input, { target: { value: "合成の質問" } });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));
    expect(input).toBeDisabled();
    fireEvent.click(expectBack());
    expect(await screen.findByText("合成一覧")).toBeInTheDocument();
  });

  it.each([
    [
      "HTTP失敗",
      () =>
        Promise.resolve(
          new Response(JSON.stringify({ message: "合成の生成失敗" }), { status: 503 }),
        ),
    ],
    ["通信失敗", () => Promise.reject(new Error("合成の生成失敗"))],
    [
      "SSE失敗",
      () => Promise.resolve(new Response('event: error\ndata: {"message":"合成の生成失敗"}\n\n')),
    ],
    ["空の応答", () => Promise.resolve(new Response(null))],
    [
      "途中終了",
      () => Promise.resolve(new Response('event: token\ndata: {"text":"合成の途中応答"}\n\n')),
    ],
  ])("既存の生成%sから一覧に戻れる", async (_label, response) => {
    getCharacter.mockResolvedValue(fixture);
    vi.spyOn(globalThis, "fetch").mockImplementation(response);
    renderChat();
    const input = await screen.findByPlaceholderText("メッセージを入力");
    fireEvent.change(input, { target: { value: "合成の質問" } });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));
    await screen.findByDisplayValue("");
    await screen.findByRole("alert");
    expect(input).toBeDisabled();
    fireEvent.click(expectBack());
    expect(await screen.findByText("合成一覧")).toBeInTheDocument();
  });
});
