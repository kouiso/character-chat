import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { characterContentSchema } from "@v2/db/character-version";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CharacterEditor } from "./character-editor";

const content = characterContentSchema.parse({
  name: "案内役",
  personality: "旅の案内人",
  speechStyle: "丁寧に話す",
  greeting: "こんにちは。",
});

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
    render(<CharacterEditor ownerUserId="local" onSaved={onSaved} />);
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
      vi.fn(async (url: string, init: RequestInit) => {
        if (init.method === "PUT") return new Response(null, { status: 409 });
        if (url.endsWith("/versions"))
          return Response.json({ currentVersionId: "v1", versions: [] });
        return Response.json({ id: "character", revision: 2, currentVersionId: "v1", content });
      }),
    );
    const onSaved = vi.fn();
    render(<CharacterEditor characterId="character" ownerUserId="local" onSaved={onSaved} />);
    fireEvent.change(await screen.findByLabelText("名前"), { target: { value: "変更中の名前" } });
    fireEvent.click(screen.getByRole("button", { name: "保存して新しい会話を始める" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("別の画面で変更");
    expect(screen.getByLabelText("名前")).toHaveValue("変更中の名前");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("版の内容を確認し、確認後に元のrevisionを指定して復元する", async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (init.method === "POST") return Response.json({ id: "character", revision: 3 });
      if (url.endsWith("/versions/v1"))
        return Response.json({ content: { ...content, name: "以前の名前" } });
      if (url.endsWith("/versions"))
        return Response.json({
          currentVersionId: "v2",
          versions: [{ id: "v1", version: 1, createdAt: 1000 }],
        });
      return Response.json({ id: "character", revision: 2, currentVersionId: "v2", content });
    });
    vi.stubGlobal("fetch", fetchMock);
    const onSaved = vi.fn().mockResolvedValue(undefined);
    render(<CharacterEditor characterId="character" ownerUserId="local" onSaved={onSaved} />);
    fireEvent.click(await screen.findByRole("button", { name: "版 1 の内容を見る" }));
    expect(await screen.findByText("以前の名前")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "この版に戻して新しい会話を始める" }));
    expect(screen.getByLabelText("名前")).toBeDisabled();
    expect(screen.getByRole("button", { name: "版 1 の内容を見る" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "実行" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("character"));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/characters/character/restore",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ versionId: "v1", expectedRevision: 2 }),
      }),
    );
  });
});
