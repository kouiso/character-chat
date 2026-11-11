import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CHARACTER_DRAFT_KEY, readCharacterDraft } from "@/lib/character-draft";
import { generateCharacter, type GeneratedCharacter } from "@/lib/character-generator";
import type * as CharacterGeneratorModule from "@/lib/character-generator";

import { CreateFlow } from "./ou-create-flow";

vi.mock("@/lib/character-generator", async (importOriginal) => {
  const original = await importOriginal<typeof CharacterGeneratorModule>();
  return { ...original, generateCharacter: vi.fn() };
});

const generated: GeneratedCharacter = {
  name: "あおい",
  characterGender: "female",
  targetUserGender: "any",
  relationshipToUser: "旅の仲間",
  personality: "穏やか",
  scenario: "図書館で出会う",
  greeting: "こんにちは",
  tags: ["読書"],
  eroticProfile: "",
};

const props = () => ({
  open: true,
  onOpenChange: vi.fn(),
  onSaveDirectly: vi.fn(),
  onEditAndSave: vi.fn(),
});

const generatePreview = async () => {
  vi.mocked(generateCharacter).mockResolvedValueOnce(generated);
  fireEvent.click(screen.getByText("おまかせでつくる"));
  fireEvent.click(screen.getByRole("button", { name: "もう作って" }));
  await screen.findByText("できあがり");
};

describe("キャラ作成下書き", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.mocked(generateCharacter).mockReset();
  });

  it("おまかせの未送信入力と関係を再起動後も復元する", () => {
    const first = render(<CreateFlow {...props()} />);
    fireEvent.click(screen.getByText("おまかせでつくる"));
    fireEvent.click(screen.getByRole("button", { name: "先輩" }));
    fireEvent.change(screen.getByPlaceholderText("ことばで答える…"), {
      target: { value: "読書好き" },
    });
    first.unmount();
    render(<CreateFlow {...props()} />);
    expect(screen.getByPlaceholderText("ことばで答える…")).toHaveValue("読書好き");
    fireEvent.click(screen.getByRole("button", { name: "もう作って" }));
    expect(generateCharacter).toHaveBeenCalledWith(
      expect.objectContaining({
        selections: expect.objectContaining({ relations: ["先輩"] }),
        details: expect.stringContaining("読書好き"),
      }),
    );
  });

  it("シナリオの入力を戻る操作と再起動後も復元する", () => {
    const first = render(<CreateFlow {...props()} />);
    fireEvent.click(screen.getByText("シナリオからつくる"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "図書館で本を探すふたり" } });
    fireEvent.click(screen.getByRole("button", { name: "もどる" }));
    fireEvent.click(screen.getByText("シナリオからつくる"));
    expect(screen.getByRole("textbox")).toHaveValue("図書館で本を探すふたり");
    first.unmount();
    render(<CreateFlow {...props()} />);
    expect(screen.getByRole("textbox")).toHaveValue("図書館で本を探すふたり");
  });

  it("保存失敗ではプレビューと下書きを残し成功後だけ消す", async () => {
    const current = props();
    current.onSaveDirectly
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(undefined);
    render(<CreateFlow {...current} />);
    await generatePreview();
    const save = screen.getByRole("button", { name: /この子に/ });
    fireEvent.click(save);
    await screen.findByRole("alert");
    expect(current.onOpenChange).not.toHaveBeenCalled();
    expect(readCharacterDraft()?.result?.name).toBe("あおい");
    fireEvent.click(save);
    await waitFor(() => expect(current.onOpenChange).toHaveBeenCalledWith(false));
    expect(localStorage.getItem(CHARACTER_DRAFT_KEY)).toBeNull();
  });

  it("保存完了前は二重送信せず閉じない", async () => {
    const current = props();
    let finish: (() => void) | undefined;
    current.onSaveDirectly.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(<CreateFlow {...current} />);
    await generatePreview();
    const save = screen.getByRole("button", { name: /この子に/ });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(current.onSaveDirectly).toHaveBeenCalledTimes(1);
    expect(current.onOpenChange).not.toHaveBeenCalled();
    expect(save).toBeDisabled();
    await act(async () => {
      finish?.();
    });
    expect(current.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("中断後に届いた生成結果で入力画面を上書きしない", async () => {
    let finish: ((value: GeneratedCharacter) => void) | undefined;
    vi.mocked(generateCharacter).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<CreateFlow {...props()} />);
    fireEvent.click(screen.getByText("おまかせでつくる"));
    fireEvent.click(screen.getByRole("button", { name: "もう作って" }));
    fireEvent.click(screen.getByRole("button", { name: "中断" }));
    await act(async () => {
      finish?.(generated);
    });
    expect(screen.getByText("おまかせでつくる")).toBeInTheDocument();
    expect(screen.queryByText("できあがり")).not.toBeInTheDocument();
  });

  it("ことばで直すが失敗してもプレビューと下書きを残す", async () => {
    render(<CreateFlow {...props()} />);
    await generatePreview();
    vi.mocked(generateCharacter).mockRejectedValueOnce(new Error("offline"));
    fireEvent.change(screen.getByPlaceholderText(/もっと強気に/), {
      target: { value: "もっと強気に" },
    });
    fireEvent.click(screen.getByRole("button", { name: "直す" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("作り直せませんでした");
    expect(screen.getByText("できあがり")).toBeInTheDocument();
    expect(readCharacterDraft()?.step).toBe("preview");
    expect(readCharacterDraft()?.result?.name).toBe("あおい");
  });

  it("顔の作り直しが失敗してもプレビューと下書きを残す", async () => {
    render(<CreateFlow {...props()} />);
    await generatePreview();
    vi.mocked(generateCharacter).mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: /画像だけ再試行|別の顔/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("作り直せませんでした");
    expect(screen.getByText("できあがり")).toBeInTheDocument();
    expect(readCharacterDraft()?.step).toBe("preview");
  });

  it("作り直し失敗の通知は次の作り直し成功で消える", async () => {
    render(<CreateFlow {...props()} />);
    await generatePreview();
    vi.mocked(generateCharacter)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ ...generated, avatar: "new-face" });
    fireEvent.click(screen.getByRole("button", { name: /画像だけ再試行|別の顔/ }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: /画像だけ再試行|別の顔/ }));
    await waitFor(() => expect(readCharacterDraft()?.result?.avatar).toBe("new-face"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("作り直し失敗のあと戻って作り直した新しいプレビューに古い通知を残さない", async () => {
    render(<CreateFlow {...props()} />);
    await generatePreview();
    vi.mocked(generateCharacter).mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: /画像だけ再試行|別の顔/ }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getAllByRole("button", { name: "もどる" })[0]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await generatePreview();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("保存失敗の通知はプレビューを離れたら消える", async () => {
    const current = props();
    current.onSaveDirectly.mockRejectedValueOnce(new Error("offline"));
    render(<CreateFlow {...current} />);
    await generatePreview();
    fireEvent.click(screen.getByRole("button", { name: /この子に/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("保存できませんでした");
    fireEvent.click(screen.getAllByRole("button", { name: "もどる" })[0]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await generatePreview();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("作り直し中に戻って新しく作ったら、古い作り直しは新しいプレビューを止めも汚しもしない", async () => {
    const current = props();
    render(<CreateFlow {...current} />);
    await generatePreview();
    let fail: ((reason: Error) => void) | undefined;
    vi.mocked(generateCharacter).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    fireEvent.click(screen.getByRole("button", { name: /画像だけ再試行|別の顔/ }));
    fireEvent.click(screen.getAllByRole("button", { name: "もどる" })[0]);
    vi.mocked(generateCharacter).mockResolvedValueOnce({ ...generated, name: "ひかり" });
    fireEvent.click(screen.getByText("おまかせでつくる"));
    fireEvent.click(screen.getByRole("button", { name: "もう作って" }));
    await screen.findByText("できあがり");
    await act(async () => {
      fail?.(new Error("offline"));
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    const save = screen.getByRole("button", { name: /この子に/ });
    expect(save).not.toBeDisabled();
    fireEvent.click(save);
    await waitFor(() =>
      expect(current.onSaveDirectly).toHaveBeenCalledWith(
        expect.objectContaining({ name: "ひかり" }),
      ),
    );
  });

  it("壊れた下書きでも起動できる", () => {
    localStorage.setItem(CHARACTER_DRAFT_KEY, "{broken");
    render(<CreateFlow {...props()} />);
    expect(screen.getByText("おまかせでつくる")).toBeInTheDocument();
  });

  it("ストレージ保存不可を通知する", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    render(<CreateFlow {...props()} />);
    fireEvent.click(screen.getByText("シナリオからつくる"));
    expect(screen.getByRole("alert")).toHaveTextContent("この端末に下書きを保存できません");
  });

  // 素材管理の「この素材でつくる」は、選んだ画像で作り始める操作。古いプレビューのまま開くと
  // 選んだ画像が表に出ず、下書きへ黙って混ざる。
  it("プレビューの下書きが残っていても、素材を選んで開いたらその素材で作り始める", async () => {
    const first = render(<CreateFlow {...props()} />);
    await generatePreview();
    first.unmount();
    const asset = "data:image/png;base64,QUJD";
    render(<CreateFlow {...props()} initialUploadedImage={asset} />);
    expect(screen.queryByText("できあがり")).not.toBeInTheDocument();
    vi.mocked(generateCharacter).mockResolvedValueOnce({ ...generated, avatar: "ai-face" });
    fireEvent.click(screen.getByText("おまかせでつくる"));
    fireEvent.click(screen.getByRole("button", { name: "もう作って" }));
    await screen.findByText("できあがり");
    // 下書きへの反映は描画後の effect なので、表示が出た直後に読むと古い値を拾うことがある
    await waitFor(() => expect(readCharacterDraft()?.result?.avatar).toBe(asset));
  });

  it("生成済みのプレビューは、確かめずに下書きを破棄しない", async () => {
    render(<CreateFlow {...props()} />);
    await generatePreview();
    fireEvent.click(screen.getByRole("button", { name: "下書きを破棄" }));
    expect(screen.getByText("できあがり")).toBeInTheDocument();
    expect(readCharacterDraft()?.result?.name).toBe("あおい");
    fireEvent.click(screen.getByRole("button", { name: "本当に破棄する" }));
    expect(screen.queryByText("できあがり")).not.toBeInTheDocument();
    expect(localStorage.getItem(CHARACTER_DRAFT_KEY)).toBeNull();
  });

  it("破棄の確かめは画面を移ると取り消される", async () => {
    render(<CreateFlow {...props()} />);
    fireEvent.click(screen.getByText("シナリオからつくる"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "図書館" } });
    fireEvent.click(screen.getByRole("button", { name: "下書きを破棄" }));
    fireEvent.click(screen.getByRole("button", { name: "もどる" }));
    expect(screen.getByRole("button", { name: "下書きを破棄" })).toBeInTheDocument();
    expect(readCharacterDraft()?.scenarioText).toBe("図書館");
  });

  // 保存は成功したのに閉じる・移る処理で例外が出た時、失敗扱いにすると再試行で二重に作られる。
  it("保存が成功した後の処理で例外が出ても、失敗の通知も二重保存も出さない", async () => {
    const current = props();
    current.onSaveDirectly.mockResolvedValueOnce(undefined);
    current.onOpenChange.mockImplementationOnce(() => {
      throw new Error("navigation");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<CreateFlow {...current} />);
    await generatePreview();
    fireEvent.click(screen.getByRole("button", { name: /この子に/ }));
    await waitFor(() => expect(current.onOpenChange).toHaveBeenCalledWith(false));
    expect(
      screen.queryByText("保存できませんでした。内容は残っています。もう一度保存してください。"),
    ).not.toBeInTheDocument();
    expect(current.onSaveDirectly).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(CHARACTER_DRAFT_KEY)).toBeNull();
  });

  it("何も入力していない画面では、保存領域が使えなくても警告を出さない", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("denied");
    });
    render(<CreateFlow {...props()} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // 素材で作ったプレビューを、同じ素材を持ったまま開き直した時（履歴で戻るなど）は、そのプレビューを出す。
  it("同じ素材で作ったプレビューは、同じ素材を持って開き直しても残す", async () => {
    const asset = "data:image/png;base64,QUJD";
    const first = render(<CreateFlow {...props()} initialUploadedImage={asset} />);
    await generatePreview();
    expect(readCharacterDraft()?.result?.avatar).toBe(asset);
    first.unmount();
    render(<CreateFlow {...props()} initialUploadedImage={asset} />);
    expect(screen.getByText("できあがり")).toBeInTheDocument();
  });
});
