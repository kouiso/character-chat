import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { characterContentSchema } from "@v2/db/character-version";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CharacterEditor } from "./character-editor";

import type { AnyRootRoute } from "@tanstack/react-router";

const content = characterContentSchema.parse({
  name: "案内役",
  personality: "旅の案内人",
  speechStyle: "丁寧に話す",
  greeting: "こんにちは。",
});

const renderWithRouter = async (node: React.ReactNode) => {
  const root = createRootRoute({ component: () => <Outlet /> });
  const children = [
    createRoute({
      getParentRoute: (): AnyRootRoute => root,
      path: "/characters/$id",
      component: () => node,
    }),
    createRoute({
      getParentRoute: (): AnyRootRoute => root,
      path: "/characters/$id/versions",
      component: () => <p>versions</p>,
    }),
  ];
  const router = createRouter({
    routeTree: root.addChildren(children),
    history: createMemoryHistory({ initialEntries: ["/characters/character"] }),
  });
  render(<RouterProvider router={router} />);
};

const renderEditor = async (node: React.ReactElement<{ characterId?: string }>) => {
  // 「前の設定」リンクは編集（characterId あり）でだけ出る。作る側は router 不要。
  if (node.props.characterId) {
    await renderWithRouter(node);
    return;
  }
  render(node);
};

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CharacterEditor", () => {
  it("作成APIへ入力を送り、保存したキャラで新規会話へ進む", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ id: "created", revision: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    const onSaved = vi.fn().mockResolvedValue(undefined);
    await renderEditor(<CharacterEditor ownerUserId="local" onSaved={onSaved} />);
    fireEvent.change(await screen.findByLabelText("名前"), { target: { value: content.name } });
    fireEvent.change(screen.getByLabelText("人格"), { target: { value: content.personality } });
    fireEvent.change(screen.getByLabelText("口調・話し方"), {
      target: { value: content.speechStyle },
    });
    fireEvent.change(screen.getByLabelText("初回のひとこと"), {
      target: { value: content.greeting },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存して新しい会話を始める" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("created"));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/characters",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty("userId");
  });

  it("古いrevisionの保存を拒否されても入力を保持する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        if (init.method === "PUT") return new Response(null, { status: 409 });
        return Response.json({ id: "character", revision: 2, currentVersionId: "v1", content });
      }),
    );
    const onSaved = vi.fn();
    await renderEditor(
      <CharacterEditor characterId="character" ownerUserId="local" onSaved={onSaved} />,
    );
    fireEvent.change(await screen.findByLabelText("名前"), { target: { value: "変更中の名前" } });
    fireEvent.click(screen.getByRole("button", { name: "保存して新しい会話を始める" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("別の画面で変更");
    expect(screen.getByLabelText("名前")).toHaveValue("変更中の名前");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("版の一覧・戻しは「前の設定」の画面へつなぐ", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ id: "character", revision: 2, currentVersionId: "v2", content }),
      ),
    );
    const onSaved = vi.fn();
    await renderEditor(
      <CharacterEditor characterId="character" ownerUserId="local" onSaved={onSaved} />,
    );
    const link = await screen.findByRole("link", { name: "前の設定" });
    expect(link).toHaveAttribute("href", "/characters/character/versions");
  });
});
