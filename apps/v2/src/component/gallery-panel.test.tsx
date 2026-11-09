import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GalleryPanel } from "./gallery-panel";

const IMAGES = [
  {
    messageId: "m2",
    imageUrl: "/api/media/m2",
    generationId: "g2",
    turn: 4,
    createdAt: 200,
  },
  {
    messageId: "m1",
    imageUrl: "/api/media/m1",
    generationId: "g1",
    turn: 2,
    createdAt: 100,
  },
];

const galleryResponse = () => Response.json({ images: IMAGES }, { status: 200 });

const renderPanel = (props?: {
  onJumpToMessage?: (url: string) => void;
  onChanged?: () => void;
}) =>
  render(
    <GalleryPanel
      characterId="char"
      getConversationId={() => "conv"}
      onJumpToMessage={props?.onJumpToMessage ?? vi.fn()}
      onChanged={props?.onChanged ?? vi.fn()}
    />,
  );

describe("画像履歴ギャラリー", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("「画像履歴」で開き、新しい順の一覧を GET で読んで出す", async () => {
    const fetchMock = vi.fn(async () => galleryResponse());
    vi.stubGlobal("fetch", fetchMock);
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "画像履歴" }));

    expect(await screen.findByRole("button", { name: "ターン4の画像を開く" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ターン2の画像を開く" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/chat/char/images?conversationId=conv"),
      expect.anything(),
    );
  });

  it("画像が無ければ案内を出す", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ images: [] })));
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "画像履歴" }));

    expect(await screen.findByText(/まだありません/)).toBeInTheDocument();
  });

  it("サムネイルを押すと画像を開き、閉じられる", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => galleryResponse()));
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "画像履歴" }));
    fireEvent.click(await screen.findByRole("button", { name: "ターン4の画像を開く" }));

    expect(await screen.findByRole("dialog", { name: "画像プレビュー" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("「会話へ」で該当メッセージへ戻る指示が親へ届く", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => galleryResponse()));
    const onJumpToMessage = vi.fn();
    renderPanel({ onJumpToMessage });

    fireEvent.click(screen.getByRole("button", { name: "画像履歴" }));
    const jumpButtons = await screen.findAllByRole("button", { name: "会話へ" });
    fireEvent.click(jumpButtons[0]);

    expect(onJumpToMessage).toHaveBeenCalledWith("/api/media/m2");
  });

  it("「消す」→「本当に消す」で DELETE が飛び一覧から消え、親へ変更が伝わる", async () => {
    let removed = false;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        removed = true;
        return Response.json({ deleted: true }, { status: 200 });
      }
      // 削除後の一覧読み直しでは残り1件を返す。
      return Response.json({ images: removed ? [IMAGES[0]] : IMAGES }, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const onChanged = vi.fn();
    renderPanel({ onChanged });

    fireEvent.click(screen.getByRole("button", { name: "画像履歴" }));
    const deleteButtons = await screen.findAllByRole("button", { name: "消す" });
    fireEvent.click(deleteButtons[1]);
    fireEvent.click(await screen.findByRole("button", { name: "本当に消す" }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, init]) => init?.method === "DELETE");
      expect(String(call?.[0])).toContain("messageId=m1");
      expect(String(call?.[0])).toContain("conversationId=conv");
    });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "ターン2の画像を開く" })).not.toBeInTheDocument();
    });
    expect(onChanged).toHaveBeenCalled();
  });
});
