import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CreateFlow } from "./ou-create-flow";

// 素材管理(#823)から画像を持って開かれた時、CreateFlow はアップロード側に寄せた状態で
// 始まる必要がある。CreateFlow は常時マウントで open の開閉だけなので、useState の
// 初期値ではなく useEffect で同期している——ここが壊れると2回目以降の
// 「この素材でつくる」で画像が引き継がれなくなる（実装は functions 側ではなく
// このコンポーネントの useEffect(#823) にあるため、ブラウザ確認だけでなくユニットでも縛る）。
describe("CreateFlow の initialUploadedImage 同期", () => {
  afterEach(cleanup);

  const ASSET_SRC =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  const openWizardStep2 = () => {
    fireEvent.click(screen.getByText("こだわってつくる"));
    fireEvent.click(screen.getByRole("button", { name: /つぎへ/ }));
  };

  it("initialUploadedImage 無しでは AI 生成側のまま始まり、プレビューは出ない", () => {
    render(
      <CreateFlow open onOpenChange={vi.fn()} onSaveDirectly={vi.fn()} onEditAndSave={vi.fn()} />,
    );
    openWizardStep2();

    expect(screen.queryByAltText("選んだ素材のプレビュー")).not.toBeInTheDocument();
  });

  it("initialUploadedImage 付きで開くとアップロード側に寄せてプレビューを出す", () => {
    render(
      <CreateFlow
        open
        onOpenChange={vi.fn()}
        onSaveDirectly={vi.fn()}
        onEditAndSave={vi.fn()}
        initialUploadedImage={ASSET_SRC}
      />,
    );
    openWizardStep2();

    expect(screen.getByAltText("選んだ素材のプレビュー")).toHaveAttribute("src", ASSET_SRC);
  });
});
