import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MemoryPanel } from "./memory-panel";

const memory = {
  id: "m1",
  conversationId: "conv",
  kind: "fact",
  content: "紅茶が好き",
  pinned: true,
  sourceTurn: 3,
  createdAt: 1,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const stubFetch = (impl: (init?: RequestInit) => unknown) =>
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => impl(init)));

describe("MemoryPanel", () => {
  it("開くと記憶を読み、閉じると消える", async () => {
    const fetchMock = vi.fn(async () => Response.json({ memories: [memory] }));
    vi.stubGlobal("fetch", fetchMock);
    render(<MemoryPanel characterId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "記憶を見る" }));
    expect(await screen.findByDisplayValue("紅茶が好き")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/characters/c1/memories",
      expect.objectContaining({ cache: "no-store" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "記憶を閉じる" }));
    expect(screen.queryByDisplayValue("紅茶が好き")).toBeNull();
  });

  it("内容を直すと PATCH が飛び、保存後に再読込する", async () => {
    stubFetch((init) => {
      if (init?.method === "PATCH")
        return Response.json({ memory: { ...memory, content: "珈琲が好き" } });
      return Response.json({ memories: [memory] });
    });
    render(<MemoryPanel characterId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "記憶を見る" }));
    const box = await screen.findByLabelText("記憶の内容");
    fireEvent.change(box, { target: { value: "珈琲が好き" } });
    fireEvent.click(screen.getByRole("button", { name: "この内容で保存" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/characters/c1/memories",
        expect.objectContaining({ method: "PATCH" }),
      ),
    );
    const body = JSON.parse(
      (vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "PATCH")![1] as RequestInit)
        .body as string,
    );
    expect(body).toEqual({ memoryId: "m1", content: "珈琲が好き" });
  });

  it("固定の切り替えと消す操作が PATCH/DELETE になる", async () => {
    stubFetch(() => Response.json({ memories: [memory] }));
    render(<MemoryPanel characterId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "記憶を見る" }));
    await screen.findByDisplayValue("紅茶が好き");
    fireEvent.click(screen.getByRole("button", { name: "固定中" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/characters/c1/memories",
        expect.objectContaining({ method: "PATCH" }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "消す" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/characters/c1/memories",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
  });

  it("新しい記憶を足すと POST が飛ぶ", async () => {
    stubFetch((init) => {
      if (init?.method === "POST") return Response.json({ memory }, { status: 201 });
      return Response.json({ memories: [] });
    });
    render(<MemoryPanel characterId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "記憶を見る" }));
    await screen.findByText("記憶はまだありません。");
    fireEvent.change(screen.getByLabelText("記憶を足す"), {
      target: { value: "新しい記憶" },
    });
    fireEvent.click(screen.getByRole("button", { name: "追加する" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/characters/c1/memories",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const body = JSON.parse(
      (vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "POST")![1] as RequestInit)
        .body as string,
    );
    expect(body).toEqual({ content: "新しい記憶", kind: "fact" });
  });

  it("読み込み失敗ではエラーを出す", async () => {
    stubFetch(() => new Response(null, { status: 503 }));
    render(<MemoryPanel characterId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "記憶を見る" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});
