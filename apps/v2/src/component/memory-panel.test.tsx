import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryPanel } from "./memory-panel";

afterEach(cleanup);

const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../lib/memory-session", () => ({ memoryRequest: api.request }));
const memory = {
  id: "m",
  conversationId: "conversation",
  content: "図書館で集合",
  kind: "fact" as const,
  pinned: false,
  revision: 0,
  createdAt: 1,
  updatedAt: 1,
};
const show = () => render(<MemoryPanel characterId="character" conversationId="conversation" />);
beforeEach(() => {
  api.request.mockReset();
});

describe("記憶の編集画面", () => {
  it("追加・修正・固定・削除を選んだ会話へ送る", async () => {
    api.request.mockResolvedValueOnce([]);
    show();
    await screen.findByText("まだ記憶はありません。");
    expect(screen.getByRole("button", { name: "追加" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("新しい記憶"), { target: { value: memory.content } });
    api.request.mockResolvedValueOnce([memory]);
    fireEvent.click(screen.getByRole("button", { name: "追加" }));
    await screen.findByDisplayValue(memory.content);
    expect(api.request).toHaveBeenLastCalledWith(
      "character",
      "conversation",
      "POST",
      expect.objectContaining({ content: memory.content }),
    );
    fireEvent.change(screen.getByLabelText("記憶の内容"), { target: { value: "駅で集合" } });
    fireEvent.click(screen.getByLabelText("固定する"));
    api.request.mockResolvedValueOnce([
      { ...memory, content: "駅で集合", pinned: true, revision: 1 },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "変更を保存" }));
    await waitFor(() =>
      expect(api.request).toHaveBeenLastCalledWith(
        "character",
        "conversation",
        "PUT",
        expect.objectContaining({ content: "駅で集合", pinned: true, revision: 0 }),
      ),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "削除" })).toBeEnabled());
    api.request.mockResolvedValueOnce([]);
    fireEvent.click(screen.getByRole("button", { name: "削除" }));
    expect(screen.getByRole("group", { name: "削除の確認" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(api.request).not.toHaveBeenCalledWith(
      "character",
      "conversation",
      "DELETE",
      expect.anything(),
    );
    fireEvent.click(screen.getByRole("button", { name: "削除" }));
    fireEvent.click(screen.getByRole("button", { name: "削除を確定" }));
    await screen.findByText("まだ記憶はありません。");
    expect(api.request).toHaveBeenLastCalledWith("character", "conversation", "DELETE", {
      id: "m",
      revision: 1,
    });
  });

  it("競合と読込失敗で入力を消さず、最新内容への置き換えは明示操作まで待つ", async () => {
    api.request.mockResolvedValueOnce([memory]);
    show();
    await screen.findByDisplayValue(memory.content);
    fireEvent.change(screen.getByLabelText("記憶の内容"), { target: { value: "手元の編集中" } });
    api.request.mockRejectedValueOnce(new Error("別の画面で変更されています"));
    fireEvent.click(screen.getByRole("button", { name: "変更を保存" }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("記憶の内容")).toHaveValue("手元の編集中");
    api.request.mockResolvedValueOnce([{ ...memory, content: "別の画面の変更", revision: 1 }]);
    fireEvent.click(screen.getByRole("button", { name: "最新の内容を読み直す" }));
    await screen.findByText("保存済みの内容は別の画面で変わっています。");
    expect(screen.getByLabelText("記憶の内容")).toHaveValue("手元の編集中");
    fireEvent.click(screen.getByRole("button", { name: "入力を最新の内容に置き換える" }));
    expect(screen.getByLabelText("記憶の内容")).toHaveValue("別の画面の変更");
  });

  it("別の画面で削除された行は未保存入力を保持し、保存せず破棄できる", async () => {
    api.request.mockResolvedValueOnce([memory]);
    show();
    await screen.findByDisplayValue(memory.content);
    fireEvent.change(screen.getByLabelText("記憶の内容"), {
      target: { value: "別の画面では消された記憶" },
    });
    api.request.mockResolvedValueOnce([]);
    fireEvent.click(screen.getByRole("button", { name: "最新の内容を読み直す" }));
    await screen.findByText(/別の画面で削除されています/);
    expect(screen.getByLabelText("記憶の内容")).toHaveValue("別の画面では消された記憶");
    expect(screen.getByRole("button", { name: "変更を保存" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "この入力を破棄" }));
    await waitFor(() => expect(screen.queryByLabelText("記憶の内容")).not.toBeInTheDocument());
    expect(api.request).toHaveBeenCalledTimes(2);
    expect(api.request).not.toHaveBeenCalledWith(
      "character",
      "conversation",
      "PUT",
      expect.anything(),
    );
  });

  it("初回の読み込みに失敗したとき、記憶がないとは表示しない", async () => {
    api.request.mockRejectedValueOnce(new Error("offline"));
    show();
    await screen.findByRole("alert");
    expect(screen.queryByText("まだ記憶はありません。")).not.toBeInTheDocument();
  });
});
