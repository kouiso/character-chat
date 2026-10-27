import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadProactiveSettings, saveProactiveSettings } from "../lib/proactive-notification-client";

import { ProactiveSettings } from "./proactive-settings";

import type * as ProactiveClient from "../lib/proactive-notification-client";
import type { ProactiveState } from "../lib/proactive-notification-contract";

vi.mock("../lib/proactive-notification-client", async (original) => ({
  ...(await original<typeof ProactiveClient>()),
  loadProactiveSettings: vi.fn(),
  saveProactiveSettings: vi.fn(),
}));

const load = vi.mocked(loadProactiveSettings);
const save = vi.mocked(saveProactiveSettings);
const state = (characterId = "synthetic-character", enabled = false): ProactiveState => ({
  characterId,
  settings: { enabled, dailyLimit: 3, idleMinutes: 60, quietHours: null },
  schedule: null,
  timeZone: "Asia/Tokyo",
  deliveryMode: "mock-only",
});
const toggle = () => screen.getByRole("checkbox", { name: "このキャラクターからの通知を受け取る" });
const submit = () => fireEvent.click(screen.getByRole("button", { name: "設定を保存" }));
const ready = async () => waitFor(() => expect(toggle()).not.toBeDisabled());
const deferred = <T,>() => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
};

beforeEach(() => {
  load.mockReset().mockResolvedValue(state());
  save.mockReset().mockResolvedValue(state());
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("proactive character settings UI", () => {
  it("取得完了前はOFF表示と操作不可で、自動ONや自動保存をしない", async () => {
    const pending = deferred<ProactiveState>();
    load.mockReturnValueOnce(pending.promise);
    render(<ProactiveSettings characterId="synthetic-character" />);
    expect(toggle()).not.toBeChecked();
    expect(toggle()).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("読み込み中");
    await act(async () => pending.resolve(state()));
    await ready();
    expect(toggle()).not.toBeChecked();
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByLabelText("このキャラクターの1日上限（通）")).toHaveValue(3);
  });

  it("本人のON・日上限・idle・JST静穏入力だけを保存する", async () => {
    save.mockImplementation(async (_endpoint, _characterId, settings) => ({
      ...state(),
      settings,
    }));
    render(<ProactiveSettings characterId="synthetic-character" />);
    await ready();
    fireEvent.click(toggle());
    fireEvent.change(screen.getByLabelText("操作後に待つ時間（分）"), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "静穏時間を設定する（日本時間）" }));
    fireEvent.change(screen.getByLabelText("開始（日本時間）"), { target: { value: "22:00" } });
    fireEvent.change(screen.getByLabelText("終了（日本時間）"), { target: { value: "08:00" } });
    submit();
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0].slice(0, 3)).toEqual([
      "/api/proactive/synthetic-character",
      "synthetic-character",
      {
        enabled: true,
        dailyLimit: 3,
        idleMinutes: 15,
        quietHours: { startMinute: 1320, endMinute: 480 },
      },
    ]);
    expect(await screen.findByText("設定を保存しました。")).toBeInTheDocument();
    expect(
      screen.getByText("この環境では通知を送信せず、予定の動作を確認できます。"),
    ).toBeInTheDocument();
  });

  it("保存失敗でもdraftを残し、同じ入力で再試行できる", async () => {
    save.mockRejectedValueOnce(new Error("synthetic-private-internal"));
    render(<ProactiveSettings characterId="synthetic-character" />);
    await ready();
    fireEvent.click(toggle());
    fireEvent.change(screen.getByLabelText("このキャラクターの1日上限（通）"), {
      target: { value: "4" },
    });
    submit();
    expect(await screen.findByRole("alert")).not.toHaveTextContent("synthetic-private-internal");
    expect(toggle()).toBeChecked();
    expect(screen.getByLabelText("このキャラクターの1日上限（通）")).toHaveValue(4);
    submit();
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][2]).toEqual(save.mock.calls[0][2]);
  });

  it("取得失敗はOFFのまま保存不可、再読込で復帰できる", async () => {
    load.mockRejectedValueOnce(new Error("synthetic-private-internal"));
    render(<ProactiveSettings characterId="synthetic-character" />);
    expect(await screen.findByRole("alert")).not.toHaveTextContent("synthetic-private-internal");
    expect(toggle()).not.toBeChecked();
    expect(toggle()).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "設定を再読み込み" }));
    await ready();
    expect(load).toHaveBeenCalledTimes(2);
    expect(save).not.toHaveBeenCalled();
  });

  it("offlineでは入力を保持して保存を止め、接続後に再試行できる", async () => {
    render(<ProactiveSettings characterId="synthetic-character" />);
    await ready();
    fireEvent.click(toggle());
    await act(async () => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByRole("button", { name: "設定を保存" })).toBeDisabled();
    expect(toggle()).toBeChecked();
    expect(save).not.toHaveBeenCalled();
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    submit();
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
  });

  it("古いcharacter取得の遅延応答を次characterへ表示しない", async () => {
    const old = deferred<ProactiveState>();
    const current = deferred<ProactiveState>();
    load.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const view = render(<ProactiveSettings characterId="synthetic-first" />);
    view.rerender(<ProactiveSettings characterId="synthetic-second" />);
    await act(async () => old.resolve(state("synthetic-first", true)));
    expect(toggle()).not.toBeChecked();
    expect(toggle()).toBeDisabled();
    await act(async () => current.resolve(state("synthetic-second")));
    await ready();
    expect(toggle()).not.toBeChecked();
    expect(save).not.toHaveBeenCalled();
  });

  it("保存中の連打を抑え、同時刻静穏は送信前に訂正を求める", async () => {
    const pending = deferred<ProactiveState>();
    save.mockReturnValueOnce(pending.promise);
    render(<ProactiveSettings characterId="synthetic-character" />);
    await ready();
    fireEvent.click(screen.getByRole("checkbox", { name: "静穏時間を設定する（日本時間）" }));
    for (const label of ["開始（日本時間）", "終了（日本時間）"])
      fireEvent.change(screen.getByLabelText(label), { target: { value: "08:00" } });
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("異なる開始・終了時刻");
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: "静穏時間を設定する（日本時間）" }));
    submit();
    expect(screen.getByRole("button", { name: "保存中です…" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "保存中です…" }));
    expect(save).toHaveBeenCalledOnce();
    await act(async () => pending.resolve(state()));
  });

  it("配信先未設定では送信されないことを明示する", async () => {
    load.mockResolvedValueOnce({ ...state(), deliveryMode: "unavailable" });
    render(<ProactiveSettings characterId="synthetic-character" />);
    expect(
      await screen.findByText("通知の配信先は未設定です。この環境では通知を有効にできません。"),
    ).toBeInTheDocument();
    expect(toggle()).not.toBeChecked();
    expect(toggle()).toBeDisabled();
  });

  it("配信先未設定でも既存ONをOFFにする操作は妨げない", async () => {
    load.mockResolvedValueOnce({
      ...state("synthetic-character", true),
      deliveryMode: "unavailable",
    });
    render(<ProactiveSettings characterId="synthetic-character" />);
    await ready();
    expect(toggle()).toBeChecked();
    fireEvent.click(toggle());
    expect(toggle()).toBeDisabled();
    submit();
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][2].enabled).toBe(false);
  });
});
