import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { characterContentSchema } from "@v2/db/character-version";
import { afterEach, describe, expect, it, vi } from "vitest";

import { characterDraftKey } from "../lib/character-draft";

import { CharacterForm } from "./character-form";

const content = characterContentSchema.parse({
  name: "案内役",
  personality: "旅の案内人",
  speechStyle: "丁寧に話す",
  greeting: "こんにちは。",
});
const submitName = "保存して新しい会話を始める";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("CharacterForm", () => {
  it("未完成の下書きと元のrevisionを復元し、別所有者には混ぜない", async () => {
    const key = characterDraftKey("owner", "character");
    const first = render(
      <CharacterForm initial={content} revision={2} draftKey={key} onSubmit={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText("名前"), { target: { value: "編集中" } });
    await waitFor(() => expect(localStorage.getItem(key)).toContain("編集中"));
    first.unmount();
    const save = vi.fn().mockResolvedValue(false);
    const second = render(
      <CharacterForm initial={content} revision={3} draftKey={key} onSubmit={save} />,
    );
    expect(screen.getByLabelText("名前")).toHaveValue("編集中");
    expect(screen.getByRole("alert")).toHaveTextContent("古い版");
    fireEvent.click(screen.getByRole("button", { name: submitName }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: "編集中" }), 2),
    );
    second.unmount();
    render(
      <CharacterForm
        initial={content}
        revision={3}
        draftKey={characterDraftKey("other", "character")}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("名前")).toHaveValue("案内役");
  });

  it("保存失敗で入力を保持し、成功した時だけ下書きを消す", async () => {
    const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const key = characterDraftKey("owner", "character");
    render(<CharacterForm initial={content} revision={0} draftKey={key} onSubmit={save} />);
    fireEvent.change(screen.getByLabelText("タグ"), { target: { value: "案内、旅行" } });
    fireEvent.click(screen.getByRole("button", { name: submitName }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem(key)).toContain("旅行");
    fireEvent.click(await screen.findByRole("button", { name: submitName }));
    await waitFor(() => expect(localStorage.getItem(key)).toBeNull());
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ tags: ["案内", "旅行"] }), 0);
  });

  it("上限を超えた入力は送らず、入力内容を残す", async () => {
    const save = vi.fn();
    render(<CharacterForm initial={content} revision={0} draftKey="draft" onSubmit={save} />);
    fireEvent.change(screen.getByLabelText("タグ"), { target: { value: "1,2,3,4,5,6" } });
    fireEvent.click(screen.getByRole("button", { name: submitName }));
    expect(await screen.findByRole("alert")).toHaveTextContent("上限");
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByLabelText("タグ")).toHaveValue("1,2,3,4,5,6");
  });

  it("音声の参照IDの入力欄を出さず、保存済みの値は編集保存でも引き継ぐ", async () => {
    const saved = characterContentSchema.parse({ ...content, voiceRef: "voice-ref-123" });
    const save = vi.fn().mockResolvedValue(true);
    render(<CharacterForm initial={saved} revision={1} draftKey="draft" onSubmit={save} />);
    expect(screen.queryByLabelText("音声の参照ID")).toBeNull();
    expect(screen.queryByText(/音声の参照ID/)).toBeNull();
    fireEvent.change(screen.getByLabelText("名前"), { target: { value: "改名" } });
    fireEvent.click(screen.getByRole("button", { name: submitName }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ name: "改名", voiceRef: "voice-ref-123" }),
        1,
      ),
    );
  });
});
