import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CharacterAvatarPicker } from "./character-avatar-picker";

const album = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("../lib/avatar-album", () => ({ listAvatarCandidates: album.list }));

const Harness = ({ characterId = "c1" }: { characterId?: string | null }) => {
  const [ref, setRef] = useState<string | null>(null);
  return (
    <>
      <CharacterAvatarPicker
        characterId={characterId ?? undefined}
        savedAvatarRef={null}
        avatarRef={ref}
        onChange={setRef}
      />
      <output aria-label="参照">{ref ?? "なし"}</output>
    </>
  );
};

const reply = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  vi.stubGlobal(
    "URL",
    Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: vi.fn() }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  album.list.mockReset();
});

const openMenu = () => fireEvent.click(screen.getByRole("button", { name: "顔を変える" }));

describe("CharacterAvatarPicker", () => {
  it("画像をアップロードすると参照が入り、顔が表示される", async () => {
    vi.stubGlobal("fetch", reply(200, { avatarRef: "local/a.png" }));
    render(<Harness />);
    openMenu();
    const file = new File([new Uint8Array([1, 2])], "a.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("顔にする画像のファイル"), {
      target: { files: [file] },
    });
    await waitFor(() => expect(screen.getByLabelText("参照")).toHaveTextContent("local/a.png"));
    expect(screen.getByAltText("いまの顔")).toBeInTheDocument();
  });

  it("画像でないファイルは送らずに理由を出す", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<Harness />);
    openMenu();
    const file = new File(["x"], "a.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText("顔にする画像のファイル"), {
      target: { files: [file] },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("画像ではないファイルです");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("大きすぎるファイルは送らずに理由を出す", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<Harness />);
    openMenu();
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "a.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("顔にする画像のファイル"), { target: { files: [big] } });
    expect(screen.getByRole("alert")).toHaveTextContent("大きすぎます");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("サーバが断った理由をそのまま出し、参照は変えない", async () => {
    vi.stubGlobal(
      "fetch",
      reply(413, { message: "画像が大きすぎます。5MB までの画像を選んでください。" }),
    );
    render(<Harness />);
    openMenu();
    const file = new File([new Uint8Array([1, 2])], "a.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("顔にする画像のファイル"), {
      target: { files: [file] },
    });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("大きすぎます"));
    expect(screen.getByLabelText("参照")).toHaveTextContent("なし");
  });

  it("アルバムの画像を選んでこれにすると、参照が入る", async () => {
    album.list.mockResolvedValue([{ messageId: "m1", imageUrl: "/api/media/m1" }]);
    const fetchMock = reply(200, { avatarRef: "local/b.png" });
    vi.stubGlobal("fetch", fetchMock);
    render(<Harness />);
    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "アルバムから選ぶ" }));
    fireEvent.click(await screen.findByRole("button", { name: "この画像を選ぶ" }));
    fireEvent.click(screen.getByRole("button", { name: "これにする" }));
    await waitFor(() => expect(screen.getByLabelText("参照")).toHaveTextContent("local/b.png"));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ messageId: "m1" });
    expect(screen.getByAltText("いまの顔")).toHaveAttribute("src", "/api/media/m1");
  });

  it("アルバムに画像が無い時と、読み込めない時の文面", async () => {
    album.list.mockResolvedValueOnce([]);
    render(<Harness />);
    openMenu();
    const open = screen.getByRole("button", { name: "アルバムから選ぶ" });
    fireEvent.click(open);
    expect(await screen.findByText("この子の画像は、まだありません。")).toBeInTheDocument();
    expect(album.list).toHaveBeenCalledTimes(1);
  });

  it("新規作成中はアルバムを選べない", () => {
    render(<Harness characterId={null} />);
    openMenu();
    expect(screen.getByRole("button", { name: "アルバムから選ぶ" })).toBeDisabled();
  });
});

describe("アルバムを読み込めない時", () => {
  it("理由を出し、もう一度で読み直せる", async () => {
    album.list.mockRejectedValueOnce(new Error("x")).mockResolvedValueOnce([]);
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "顔を変える" }));
    fireEvent.click(screen.getByRole("button", { name: "アルバムから選ぶ" }));
    expect(await screen.findByText("アルバムを読み込めませんでした。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "もう一度" }));
    expect(await screen.findByText("この子の画像は、まだありません。")).toBeInTheDocument();
  });
});
