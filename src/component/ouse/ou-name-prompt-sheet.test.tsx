import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as api from "@/lib/api";

import { OuNamePromptSheet } from "./ou-name-prompt-sheet";

// 会話開始時に一度だけ出す名前プロンプト。未入力でもスキップでき、
// 決定・スキップのどちらでも「二度と出さない」既読フラグを立てる。
describe("OuNamePromptSheet", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.removeItem("ou_name_prompt_asked");
  });

  const renderSheet = (onOpenChange = vi.fn()) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <OuNamePromptSheet open onOpenChange={onOpenChange} characterName="サクラ" />
      </QueryClientProvider>,
    );
    return { client, onOpenChange };
  };

  it("初期状態では決定ボタンが無効", () => {
    renderSheet();
    expect(screen.getByRole("button", { name: "この名前で呼んでもらう" })).toBeDisabled();
  });

  it("名前を入れて決定すると保存し、既読フラグを立てて閉じる", async () => {
    const updateSpy = vi.spyOn(api, "updateMyDisplayName").mockResolvedValue("コウスケ");
    const { onOpenChange } = renderSheet();

    const input = screen.getByLabelText("あなたの名前");
    fireEvent.change(input, { target: { value: "コウスケ" } });
    fireEvent.click(screen.getByRole("button", { name: "この名前で呼んでもらう" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith("コウスケ"));
    // 既読は保存が通ってから。先に立てると、保存に失敗した人が二度と尋ねられん。
    await waitFor(() => expect(localStorage.getItem("ou_name_prompt_asked")).toBe("1"));
  });

  it("保存に失敗した時は既読にせず、次の会話開始でもう一度尋ねられる", async () => {
    const updateSpy = vi.spyOn(api, "updateMyDisplayName").mockRejectedValue(new Error("network"));
    renderSheet();

    fireEvent.change(screen.getByLabelText("あなたの名前"), { target: { value: "コウスケ" } });
    fireEvent.click(screen.getByRole("button", { name: "この名前で呼んでもらう" }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalled());
    expect(localStorage.getItem("ou_name_prompt_asked")).toBeNull();
  });

  it("あとで決める、を押すと保存せず既読フラグだけ立てて閉じる", () => {
    const updateSpy = vi.spyOn(api, "updateMyDisplayName");
    const { onOpenChange } = renderSheet();

    fireEvent.click(screen.getByRole("button", { name: "あとで決める" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(localStorage.getItem("ou_name_prompt_asked")).toBe("1");
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("入力欄は44pxの当たり判定を持つ（近接シートと同じ扱い）", () => {
    renderSheet();
    const input = screen.getByLabelText("あなたの名前");
    expect(input.className).toContain("before:min-h-[44px]");
    expect(input.className).toContain("before:min-w-[44px]");
  });
});
