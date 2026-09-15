import { useState } from "react";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { OuPhotoOverlay, type OuPhotoOverlayItem } from "./ou-media-overlay";

const photo: OuPhotoOverlayItem = {
  id: "m1",
  src: "/api/image/r2/images/m1.jpg",
  createdAt: Date.now(),
  characterId: "c1",
  characterName: "燈子",
  characterAvatar: null,
};

afterEach(cleanup);

describe("OuMediaOverlay の全画面配置", () => {
  // .ou-col(z-index:20) の子として描画すると、fixed + z-index:300 でもその祖先が作る
  // スタッキングコンテキストに閉じ込められ、兄弟のボトムナビ(z-index:40)より下に沈む。
  // document.body へ portal することでこの罠を回避しとる。呼び出し元が .ou-col の内側に
  // あっても、DOM 上は body 直下に出ることを固定する。
  it("写真ビューアは呼び出し元の祖先の外、document.body 直下へ描画される", () => {
    const { container } = render(
      <div className="ou-col" style={{ position: "relative" }}>
        <OuPhotoOverlay photo={photo} photos={[photo]} onClose={() => {}} onPick={() => {}} />
      </div>,
    );

    expect(container.querySelector('[data-screen-label="写真・全画面"]')).toBeNull();
    expect(document.body.querySelector('[data-screen-label="写真・全画面"]')).not.toBeNull();
  });
});

const OverlayHarness = () => {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        写真タイル
      </button>
      <button type="button">背景のボタン</button>
      <OuPhotoOverlay
        photo={open ? photo : null}
        photos={[photo]}
        onClose={() => setOpen(false)}
        onPick={() => {}}
      />
    </div>
  );
};

describe("OuMediaOverlay のフォーカス制御", () => {
  it("開くとフォーカスがダイアログ内へ移る", async () => {
    render(<OverlayHarness />);
    fireEvent.click(screen.getByRole("button", { name: "写真タイル" }));

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "写真を閉じる" }));
    });
  });

  it("開いている間は背景の操作子が支援技術から外れる", async () => {
    render(<OverlayHarness />);
    expect(screen.getByRole("button", { name: "背景のボタン" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "写真タイル" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "背景のボタン" })).toBeNull();
    });
  });

  it("閉じるとフォーカスが開いた要素へ戻る", async () => {
    render(<OverlayHarness />);
    const tile = screen.getByRole("button", { name: "写真タイル" });
    tile.focus();
    fireEvent.click(tile);

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "写真・全画面" })).toBeInTheDocument();
    });
    // ダイアログ内で操作を進めた状態から閉じる。閉じる操作子そのものに
    // フォーカスがある状態だと、復帰させんでもタイルへ戻ったように見えてまう。
    screen.getByRole("button", { name: "保存" }).focus();
    fireEvent.click(screen.getByRole("button", { name: "写真を閉じる" }));

    await waitFor(() => {
      expect(document.activeElement).toBe(tile);
    });
  });

  it("Escape で閉じる", async () => {
    render(<OverlayHarness />);
    fireEvent.click(screen.getByRole("button", { name: "写真タイル" }));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "写真・全画面" })).toBeInTheDocument();
    });
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "写真・全画面" })).toBeNull();
    });
  });
});
