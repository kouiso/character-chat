import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  characterDraftStorageKey,
  createCharacterDraft,
  validateCharacterDraft,
} from "../lib/character-draft";

import { CharacterEditor } from "./character-editor";

import type { CharacterSheet } from "@v2/db";

const fillRequired = () => {
  fireEvent.change(screen.getByLabelText("名前"), { target: { value: "案内係" } });
  fireEvent.change(screen.getByLabelText("最初のひとこと"), { target: { value: "こんにちは。" } });
  fireEvent.change(screen.getByLabelText("指示"), {
    target: { value: "架空の街を案内してください。" },
  });
  fireEvent.change(screen.getByLabelText("年齢（18歳以上）"), { target: { value: "18" } });
};

describe("CharacterEditor", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("画面から作成し、全項目を保存して成功後だけ下書きを消す", async () => {
    const save = vi.fn<(sheet: CharacterSheet) => Promise<void>>().mockResolvedValue();
    render(<CharacterEditor initial={null} draftKey="actor/new" onSave={save} />);
    fillRequired();
    const fields = [
      ["紹介", "街の案内係です。"],
      ["タグ（1行に1つ）", "案内\n合成"],
      ["例文", "利用者: 図書館は。\n案内係: 広場の隣です。"],
      ["世界", "架空の街"],
      ["見た目", "青い上着"],
    ];
    for (const [label, value] of fields) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    fireEvent.click(screen.getByLabelText("話しかけ設定を有効にする"));
    fireEvent.change(screen.getByLabelText("話しかける間隔（分）"), { target: { value: "30" } });
    expect(localStorage.getItem(characterDraftStorageKey("actor/new"))).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "保存する" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0]).toMatchObject({
      name: "案内係",
      age: 18,
      introduction: "街の案内係です。",
      tags: ["案内", "合成"],
      exampleDialogue: "利用者: 図書館は。\n案内係: 広場の隣です。",
      world: "架空の街",
      appearance: "青い上着",
      proactiveSettings: { enabled: true, intervalMinutes: 30 },
    });
    expect(await screen.findByText("キャラクターを保存しました。")).toBeInTheDocument();
    expect(localStorage.getItem(characterDraftStorageKey("actor/new"))).toBeNull();
  });

  it.each(["17", "", "eighteen"])("年齢 %s は保存へ渡さない", async (age) => {
    const save = vi.fn<(sheet: CharacterSheet) => Promise<void>>().mockResolvedValue();
    render(<CharacterEditor initial={null} draftKey="actor/new" onSave={save} />);
    fillRequired();
    fireEvent.change(screen.getByLabelText("年齢（18歳以上）"), { target: { value: age } });
    fireEvent.click(screen.getByRole("button", { name: "保存する" }));
    expect(await screen.findByText("18歳以上の整数を入力してください。")).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it("途中で閉じても入力と短い案と同じ新規IDを復元する", async () => {
    const save = vi.fn<(sheet: CharacterSheet) => Promise<void>>().mockResolvedValue();
    const first = render(<CharacterEditor initial={null} draftKey="actor/new" onSave={save} />);
    fillRequired();
    fireEvent.change(screen.getByLabelText("短い案"), { target: { value: "街を案内する人" } });
    const raw = localStorage.getItem(characterDraftStorageKey("actor/new"));
    first.unmount();
    render(<CharacterEditor initial={null} draftKey="actor/new" onSave={save} />);
    expect(screen.getByLabelText("名前")).toHaveValue("案内係");
    expect(screen.getByLabelText("短い案")).toHaveValue("街を案内する人");
    expect(screen.getByText("保存した下書きを復元しました。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存する" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    const envelope = JSON.parse(raw ?? "{}") as { draft: { id: string } };
    expect(save.mock.calls[0][0].id).toBe(envelope.draft.id);
  });

  it("保存失敗では入力を保持し、再試行が成功した時だけ下書きを消す", async () => {
    const save = vi
      .fn<(sheet: CharacterSheet) => Promise<void>>()
      .mockRejectedValueOnce(new Error("接続できませんでした。再試行してください。"))
      .mockResolvedValueOnce();
    render(<CharacterEditor initial={null} draftKey="actor/new" onSave={save} />);
    fillRequired();
    fireEvent.click(screen.getByRole("button", { name: "保存する" }));
    expect(
      await screen.findByText("接続できませんでした。再試行してください。"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("名前")).toHaveValue("案内係");
    expect(localStorage.getItem(characterDraftStorageKey("actor/new"))).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "保存する" }));
    await screen.findByText("キャラクターを保存しました。");
    expect(save).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(characterDraftStorageKey("actor/new"))).toBeNull();
  });

  it("下書き作りは入力済み設定と未確認の年齢を上書きしない", () => {
    render(<CharacterEditor initial={null} draftKey="actor/new" onSave={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("名前"), { target: { value: "既存の名前" } });
    fireEvent.change(screen.getByLabelText("短い案"), { target: { value: "街の図書館の案内係" } });
    fireEvent.click(screen.getByRole("button", { name: "空欄に下書きを作る" }));
    expect(screen.getByLabelText("名前")).toHaveValue("既存の名前");
    expect(screen.getByLabelText("紹介")).toHaveValue("街の図書館の案内係");
    expect(screen.getByLabelText("年齢（18歳以上）")).toHaveValue("");
  });

  it("端末保存失敗を下書き保存済みと表示しない", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    render(<CharacterEditor initial={null} draftKey="actor/new" onSave={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("名前"), { target: { value: "案内係" } });
    expect(
      screen.getByText("下書きをこの端末に保存できません。入力はこの画面に残っています。"),
    ).toBeInTheDocument();
    expect(screen.queryByText("下書きをこの端末に保存しました。")).not.toBeInTheDocument();
    expect(screen.getByLabelText("名前")).toHaveValue("案内係");
  });

  it("既存キャラを編集し、識別子と公式状態と作成日時を保持する", async () => {
    const validated = validateCharacterDraft(
      {
        ...createCharacterDraft(null),
        name: "案内係",
        greeting: "こんにちは。",
        systemPrompt: "案内してください。",
        age: "24",
      },
      null,
    );
    if (!validated.sheet) throw new Error("合成fixtureを作れませんでした。");
    const initial = {
      ...validated.sheet,
      id: "synthetic-existing",
      isOfficial: true,
      displayOrder: 7,
      createdAt: 1,
    };
    const save = vi.fn<(sheet: CharacterSheet) => Promise<void>>().mockResolvedValue();
    render(<CharacterEditor initial={initial} draftKey="actor/synthetic-existing" onSave={save} />);
    expect(screen.getByRole("heading", { name: "キャラクターを編集" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("指示"), {
      target: { value: "短く丁寧に案内してください。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存する" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0]).toMatchObject({
      id: initial.id,
      isOfficial: true,
      displayOrder: 7,
      createdAt: 1,
      systemPrompt: "短く丁寧に案内してください。",
    });
  });

  it("サーバ描画で端末ストレージを参照しない", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("storage is unavailable");
    });
    const markup = renderToString(
      <CharacterEditor initial={null} draftKey="actor/new" onSave={vi.fn()} />,
    );
    expect(markup).toContain("入力フォームを準備しています。");
  });
});
