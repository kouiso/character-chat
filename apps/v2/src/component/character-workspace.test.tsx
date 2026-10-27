import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { characterFixture } from "../../../../packages/db/src/test/character-fixture";

import { CharacterWorkspace } from "./character-workspace";

import type { CharacterTransport } from "./character-workspace";
import type { CharacterActionResult, CharacterEditorState } from "../lib/character-contract";

const previous = { ...characterFixture, systemPrompt: "丁寧な口調で案内してください。" };
const current = { ...characterFixture, systemPrompt: "短い言葉で案内してください。" };
const state: CharacterEditorState = {
  sheet: current,
  currentVersionId: 2,
  revision: "revision-2",
  versions: [
    { id: 2, characterId: current.id, createdAt: 2, sheet: current },
    { id: 1, characterId: current.id, createdAt: 1, sheet: previous },
  ],
};
const restored: CharacterEditorState = {
  ...state,
  sheet: previous,
  currentVersionId: 1,
  revision: "revision-3",
};

const makeTransport = (): CharacterTransport => ({
  list: vi.fn<CharacterTransport["list"]>().mockResolvedValue({
    ok: true,
    data: { actorKey: "owner-a", characters: [{ id: current.id, name: current.name }] },
  }),
  load: vi.fn<CharacterTransport["load"]>().mockResolvedValue({ ok: true, data: state }),
  save: vi.fn<CharacterTransport["save"]>().mockResolvedValue({ ok: true, data: state }),
  restore: vi.fn<CharacterTransport["restore"]>().mockResolvedValue({ ok: true, data: restored }),
});

const edit = async () => {
  fireEvent.click(screen.getByRole("button", { name: "案内係を編集" }));
  await screen.findByLabelText("指示");
};

beforeEach(() => {
  localStorage.clear();
});
afterEach(cleanup);

describe("character workspace", () => {
  it("一覧から編集し、全内容と日時を見て前の版に戻す", async () => {
    const transport = makeTransport();
    render(<CharacterWorkspace characters={[current]} transport={transport} />);
    await edit();
    expect(screen.getByLabelText("指示")).toHaveValue(current.systemPrompt);
    expect(screen.getByText(/^版 1 ·/)).toBeInTheDocument();
    expect(screen.getByText(previous.systemPrompt)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "版 1 に戻す" }));
    expect(transport.restore).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "入力を破棄して戻す" }));
    await waitFor(() => expect(screen.getByLabelText("指示")).toHaveValue(previous.systemPrompt));
    expect(transport.restore).toHaveBeenCalledWith({
      characterId: current.id,
      versionId: 1,
      expectedVersionId: 2,
      expectedRevision: "revision-2",
    });
    expect(screen.getByText("戻しても会話や記憶は変更しません。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "案内係と話す" })).toHaveAttribute(
      "href",
      `/chat/${current.id}`,
    );
  });

  it("復元中は新しい入力・保存を無効にして失敗しても入力を保つ", async () => {
    const transport = makeTransport();
    let finish: (result: CharacterActionResult<CharacterEditorState>) => void = () => {
      throw new Error("restore not started");
    };
    vi.mocked(transport.restore).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<CharacterWorkspace characters={[current]} transport={transport} />);
    await edit();
    fireEvent.change(screen.getByLabelText("紹介"), { target: { value: "保存前の合成紹介" } });
    fireEvent.click(screen.getByRole("button", { name: "版 1 に戻す" }));
    fireEvent.click(screen.getByRole("button", { name: "入力を破棄して戻す" }));
    expect(screen.getByLabelText("紹介")).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存する" })).toBeDisabled();
    finish({ ok: false, code: "unavailable", message: "接続できません。" });
    await waitFor(() => expect(screen.getByLabelText("紹介")).toBeEnabled());
    expect(screen.getByLabelText("紹介")).toHaveValue("保存前の合成紹介");
    expect(transport.save).not.toHaveBeenCalled();
  });

  it("初回読出しの失敗後も同じ編集対象を再試行する", async () => {
    const transport = makeTransport();
    vi.mocked(transport.load).mockRejectedValueOnce(new Error("offline"));
    render(<CharacterWorkspace characters={[current]} transport={transport} />);
    fireEvent.click(screen.getByRole("button", { name: "案内係を編集" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "読み直す" }));
    await screen.findByLabelText("指示");
    expect(transport.load).toHaveBeenNthCalledWith(1, current.id);
    expect(transport.load).toHaveBeenNthCalledWith(2, current.id);
    expect(screen.getByLabelText("指示")).toHaveValue(current.systemPrompt);
  });

  it("利用者が変わったら前の設定と履歴を新しい下書きへ混ぜない", async () => {
    const transport = makeTransport();
    const other = { id: "other-guide", name: "別の案内係" };
    render(<CharacterWorkspace characters={[current, other]} transport={transport} />);
    await edit();
    vi.mocked(transport.list).mockResolvedValue({
      ok: true,
      data: { actorKey: "owner-b", characters: [other] },
    });
    vi.mocked(transport.load).mockResolvedValue({
      ok: false,
      code: "not-found",
      message: "見つかりません。",
    });
    fireEvent.click(screen.getByRole("button", { name: "別の案内係を編集" }));
    await screen.findByText("見つかりません。");
    expect(screen.queryByLabelText("指示")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "キャラクターの版履歴" })).not.toBeInTheDocument();
  });

  it("新規入力は閉じて再度開いても残り、保存後は会話導線に現れる", async () => {
    const transport = makeTransport();
    vi.mocked(transport.save).mockImplementation(async (input) => ({
      ok: true,
      data: { sheet: input.sheet, currentVersionId: 1, revision: "saved-new", versions: [] },
    }));
    render(
      <CharacterWorkspace
        characters={[]}
        transport={transport}
        listState={(empty) => <p>{empty ? "合成一覧は空" : "合成一覧に項目あり"}</p>}
      />,
    );
    expect(screen.getByText("合成一覧は空")).toBeInTheDocument();
    expect(screen.queryByText("キャラクターが登録されていません。")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "キャラクターを作る" }));
    await screen.findByLabelText("名前");
    fireEvent.change(screen.getByLabelText("名前"), { target: { value: "合成受付係" } });
    fireEvent.change(screen.getByLabelText("指示"), {
      target: { value: "施設を案内してください。" },
    });
    fireEvent.change(screen.getByLabelText("最初のひとこと"), { target: { value: "ようこそ。" } });
    fireEvent.change(screen.getByLabelText("年齢（18歳以上）"), { target: { value: "18" } });
    fireEvent.click(screen.getByRole("button", { name: "編集を閉じる" }));
    fireEvent.click(screen.getByRole("button", { name: "キャラクターを作る" }));
    await waitFor(() => expect(screen.getByLabelText("名前")).toHaveValue("合成受付係"));
    fireEvent.click(screen.getByRole("button", { name: "保存する" }));
    await screen.findByRole("link", { name: "合成受付係と話す" });
    expect(screen.queryByText("合成一覧は空")).not.toBeInTheDocument();
    expect(screen.getByText("合成一覧に項目あり")).toBeInTheDocument();
    expect(transport.save).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersionId: null,
        expectedRevision: "",
        sheet: expect.objectContaining({ age: 18, name: "合成受付係" }),
      }),
    );
  });

  it("一覧の再取得は反映し、開いている編集と下書きを保つ", async () => {
    const transport = makeTransport();
    const { rerender } = render(<CharacterWorkspace characters={[]} transport={transport} />);
    expect(screen.getByText("キャラクターが登録されていません。")).toBeInTheDocument();
    rerender(<CharacterWorkspace characters={[current]} transport={transport} />);
    expect(screen.queryByText("キャラクターが登録されていません。")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "案内係と話す" })).toBeInTheDocument();
    await edit();
    fireEvent.change(screen.getByLabelText("紹介"), { target: { value: "編集中の合成紹介" } });
    const other = { id: "other-guide", name: "別の案内係" };
    rerender(<CharacterWorkspace characters={[current, other]} transport={transport} />);
    expect(screen.getByRole("link", { name: "別の案内係と話す" })).toBeInTheDocument();
    expect(screen.getByLabelText("紹介")).toHaveValue("編集中の合成紹介");
    expect(transport.save).not.toHaveBeenCalled();
  });

  it("保存待機中に一覧が再取得されても、完了したキャラクターを新しい一覧へ残す", async () => {
    const transport = makeTransport();
    let complete: () => void = () => {
      throw new Error("save not started");
    };
    vi.mocked(transport.save).mockImplementation(async (input) => {
      await new Promise<void>((resolve) => {
        complete = resolve;
      });
      return {
        ok: true,
        data: { sheet: input.sheet, currentVersionId: 1, revision: "saved-new", versions: [] },
      };
    });
    const { rerender } = render(<CharacterWorkspace characters={[]} transport={transport} />);
    fireEvent.click(screen.getByRole("button", { name: "キャラクターを作る" }));
    await screen.findByLabelText("名前");
    fireEvent.change(screen.getByLabelText("名前"), { target: { value: "保存待ちの合成案内係" } });
    fireEvent.change(screen.getByLabelText("指示"), {
      target: { value: "施設を案内してください。" },
    });
    fireEvent.change(screen.getByLabelText("最初のひとこと"), { target: { value: "ようこそ。" } });
    fireEvent.change(screen.getByLabelText("年齢（18歳以上）"), { target: { value: "18" } });
    fireEvent.click(screen.getByRole("button", { name: "保存する" }));
    await waitFor(() => expect(transport.save).toHaveBeenCalledTimes(1));
    const other = { id: "other-guide", name: "別の案内係" };
    rerender(<CharacterWorkspace characters={[other]} transport={transport} />);
    complete();
    await screen.findByRole("link", { name: "保存待ちの合成案内係と話す" });
    expect(screen.getByRole("link", { name: "別の案内係と話す" })).toBeInTheDocument();
  });
});
