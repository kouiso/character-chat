import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryManager } from "./memory-manager";

import type { ManagedMemory } from "@v2/db";

const memory = (overrides: Partial<ManagedMemory> = {}): ManagedMemory => ({
  id: "memory-1",
  conversationId: "conversation-1",
  memoryKey: "favorite-color",
  kind: "preference",
  content: "好きな色は緑",
  supersededById: null,
  sourceTurn: null,
  createdAt: 1,
  updatedAt: 1,
  state: "active",
  eligible: true,
  pinned: false,
  enabled: true,
  sourceType: "user",
  sourceMessageId: null,
  sourceRevision: null,
  characterVersionId: null,
  ...overrides,
});
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

describe("MemoryManager", () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(json({ enabled: true, memories: [memory()] }));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows saved content, its use status, and can load correction history", async () => {
    render(<MemoryManager conversationId="conversation-1" />);
    expect(screen.getByText("記憶を読み込んでいます…")).toBeInTheDocument();
    expect(await screen.findByText("好きな色は緑")).toBeInTheDocument();
    expect(screen.getByText("次回の会話で利用可能")).toBeInTheDocument();
    fetchMock.mockResolvedValueOnce(
      json({
        memories: [
          memory({ id: "old", content: "好きな色は青", supersededById: "memory-1" }),
          memory(),
        ],
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "履歴" }));
    const history = await screen.findByRole("region", { name: "記憶の履歴" });
    expect(within(history).getByText("好きな色は青")).toBeInTheDocument();
    expect(within(history).getByText("訂正前の記憶")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/memory/conversation-1?history=memory-1",
      expect.objectContaining({ cache: "no-store", credentials: "same-origin" }),
    );
  });

  it("adds and edits with distinct request keys, then reloads the server snapshot", async () => {
    render(<MemoryManager conversationId="conversation-1" />);
    await screen.findByText("好きな色は緑");
    fireEvent.change(screen.getByLabelText("覚えておく内容"), {
      target: { value: "好きな飲み物はお茶" },
    });
    fetchMock
      .mockResolvedValueOnce(json({ memory: memory() }))
      .mockResolvedValueOnce(json({ enabled: true, memories: [memory()] }));
    fireEvent.click(screen.getByRole("button", { name: "追加する" }));
    await waitFor(() => expect(screen.getByLabelText("覚えておく内容")).toHaveValue(""));
    await waitFor(() => expect(screen.getByRole("button", { name: "訂正" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "訂正" }));
    fireEvent.change(screen.getByLabelText("訂正後の内容"), { target: { value: "好きな色は紫" } });
    fetchMock
      .mockResolvedValueOnce(json({ memory: memory({ content: "好きな色は紫" }) }))
      .mockResolvedValueOnce(
        json({ enabled: true, memories: [memory({ content: "好きな色は紫" })] }),
      );
    fireEvent.click(screen.getByRole("button", { name: "訂正を保存" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "訂正" })).toBeEnabled());
    expect(screen.getByText("好きな色は紫")).toBeInTheDocument();
    const commands = fetchMock.mock.calls
      .filter(([, init]) => init?.method === "POST")
      .map(
        ([, init]) =>
          JSON.parse(String(init?.body)) as { action: string; requestKey: string; content: string },
      );
    expect(commands).toHaveLength(2);
    expect(commands[0]).toMatchObject({
      action: "add",
      content: "好きな飲み物はお茶",
      requestKey: expect.any(String),
    });
    expect(commands[1]).toMatchObject({
      action: "edit",
      content: "好きな色は紫",
      requestKey: expect.any(String),
    });
    expect(commands[0].requestKey).not.toBe(commands[1].requestKey);
  });

  it("requires a delete confirmation and never renders deleted contents", async () => {
    render(<MemoryManager conversationId="conversation-1" />);
    await screen.findByText("好きな色は緑");
    fireEvent.click(screen.getByRole("button", { name: "削除" }));
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    expect(screen.getByRole("group", { name: "削除の確認" })).toBeInTheDocument();
    fetchMock.mockResolvedValueOnce(json({ ok: true })).mockResolvedValueOnce(
      json({
        enabled: true,
        memories: [memory({ state: "deleted", content: "hidden deleted value" })],
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "削除する" }));
    expect(await screen.findByText("削除済み")).toBeInTheDocument();
    expect(screen.queryByText("hidden deleted value")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "訂正" })).not.toBeInTheDocument();
  });

  it("keeps stored content visible while memory use is off and exposes pin/per-item toggles", async () => {
    render(<MemoryManager conversationId="conversation-1" />);
    await screen.findByText("好きな色は緑");
    fetchMock
      .mockResolvedValueOnce(json({ ok: true }))
      .mockResolvedValueOnce(json({ enabled: true, memories: [memory({ pinned: true })] }));
    fireEvent.click(screen.getByRole("button", { name: "ピン留め" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "ピン留め" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    fetchMock
      .mockResolvedValueOnce(json({ ok: true }))
      .mockResolvedValueOnce(json({ enabled: true, memories: [memory({ enabled: false })] }));
    fireEvent.click(screen.getByLabelText("この記憶を利用"));
    expect(await screen.findByText("保存済み・利用停止中")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("記憶を利用する")).toBeEnabled());
    fetchMock
      .mockResolvedValueOnce(json({ ok: true }))
      .mockResolvedValueOnce(json({ enabled: false, memories: [memory()] }));
    fireEvent.click(screen.getByLabelText("記憶を利用する"));
    expect(
      await screen.findByText("保存済みの記憶は残ります。記憶の参照と自動追加を停止しています。"),
    ).toBeInTheDocument();
    expect(screen.getByText("好きな色は緑")).toBeInTheDocument();
  });

  it("retries a failed add using the same request key and retains the draft", async () => {
    render(<MemoryManager conversationId="conversation-1" />);
    await screen.findByText("好きな色は緑");
    fireEvent.change(screen.getByLabelText("覚えておく内容"), {
      target: { value: "好きな果物は梨" },
    });
    fetchMock.mockRejectedValueOnce(new TypeError("接続が切れました。"));
    fireEvent.click(screen.getByRole("button", { name: "追加する" }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("覚えておく内容")).toHaveValue("好きな果物は梨");
    fetchMock
      .mockResolvedValueOnce(json({ memory: memory() }))
      .mockResolvedValueOnce(json({ enabled: true, memories: [memory()] }));
    fireEvent.click(screen.getByRole("button", { name: "操作を再試行" }));
    await waitFor(() => expect(screen.getByLabelText("覚えておく内容")).toHaveValue(""));
    const commands = fetchMock.mock.calls
      .filter(([, init]) => init?.method === "POST")
      .map(([, init]) => init?.body);
    expect(commands).toHaveLength(2);
    expect(commands[0]).toBe(commands[1]);
  });

  it("recovers from initial load failure and does not show a late response from a previous conversation", async () => {
    let finishOld: ((response: Response) => void) | undefined;
    fetchMock.mockRejectedValueOnce(new Error("一時的な接続エラー"));
    const view = render(<MemoryManager conversationId="conversation-1" />);
    await screen.findByRole("alert");
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    );
    fireEvent.click(screen.getByRole("button", { name: "再読み込み" }));
    fetchMock.mockResolvedValueOnce(
      json({
        enabled: true,
        memories: [
          memory({ id: "other", conversationId: "conversation-2", content: "新しい会話の記憶" }),
        ],
      }),
    );
    view.rerender(<MemoryManager conversationId="conversation-2" />);
    expect(screen.queryByText("好きな色は緑")).not.toBeInTheDocument();
    expect(await screen.findByText("新しい会話の記憶")).toBeInTheDocument();
    finishOld?.(json({ enabled: true, memories: [memory({ content: "古い会話の遅延応答" })] }));
    await waitFor(() => expect(screen.queryByText("古い会話の遅延応答")).not.toBeInTheDocument());
  });
  it("discards history that was requested before a deletion", async () => {
    let finishHistory: ((response: Response) => void) | undefined;
    render(<MemoryManager conversationId="conversation-1" />);
    await screen.findByText("好きな色は緑");
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishHistory = resolve;
        }),
    );
    fireEvent.click(screen.getByRole("button", { name: "履歴" }));
    fireEvent.click(screen.getByRole("button", { name: "削除" }));
    fetchMock
      .mockResolvedValueOnce(json({ ok: true }))
      .mockResolvedValueOnce(
        json({ enabled: true, memories: [memory({ state: "deleted", content: "" })] }),
      );
    fireEvent.click(screen.getByRole("button", { name: "削除する" }));
    await screen.findByText("削除済み");
    finishHistory?.(json({ memories: [memory({ content: "削除前に要求した履歴" })] }));
    await waitFor(() => expect(screen.queryByText("削除前に要求した履歴")).not.toBeInTheDocument());
    expect(screen.queryByRole("region", { name: "記憶の履歴" })).not.toBeInTheDocument();
  });

  it("does not retain a deleted snapshot when refreshing the committed result fails", async () => {
    render(<MemoryManager conversationId="conversation-1" />);
    await screen.findByText("好きな色は緑");
    fireEvent.click(screen.getByRole("button", { name: "削除" }));
    fetchMock.mockResolvedValueOnce(json({ ok: true })).mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "削除する" }));
    await screen.findByRole("alert");
    expect(screen.queryByText("好きな色は緑")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "操作を再試行" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "再読み込み" })).toBeEnabled();
  });

  it("hides a delete immediately when only its response is lost and confirms deletion on retry", async () => {
    let failResponse: ((error: Error) => void) | undefined;
    render(<MemoryManager conversationId="conversation-1" />);
    await screen.findByText("好きな色は緑");
    fireEvent.click(screen.getByRole("button", { name: "削除" }));
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          failResponse = reject;
        }),
    );
    fireEvent.click(screen.getByRole("button", { name: "削除する" }));
    expect(screen.queryByText("好きな色は緑")).not.toBeInTheDocument();
    expect(screen.queryByText("次回の会話で利用可能")).not.toBeInTheDocument();
    expect(
      screen.getByText("削除状態を確認中です。確認できるまで対象の内容を表示しません。"),
    ).toBeInTheDocument();
    failResponse?.(new TypeError("response lost after server commit"));
    await screen.findByRole("alert");
    expect(screen.queryByText("好きな色は緑")).not.toBeInTheDocument();
    fetchMock
      .mockResolvedValueOnce(json({ ok: true }))
      .mockResolvedValueOnce(
        json({ enabled: true, memories: [memory({ state: "deleted", content: "" })] }),
      );
    fireEvent.click(screen.getByRole("button", { name: "操作を再試行" }));
    expect(await screen.findByText("削除済み")).toBeInTheDocument();
    const commands = fetchMock.mock.calls
      .filter(([, init]) => init?.method === "POST")
      .map(([, init]) => init?.body);
    expect(commands).toHaveLength(2);
    expect(commands[0]).toBe(commands[1]);
    expect(screen.queryByText("好きな色は緑")).not.toBeInTheDocument();
  });

  it("keeps an uncertain deletion hidden when a refresh still returns the active old row", async () => {
    render(<MemoryManager conversationId="conversation-1" />);
    await screen.findByText("好きな色は緑");
    fireEvent.click(screen.getByRole("button", { name: "削除" }));
    fetchMock.mockRejectedValueOnce(new TypeError("delete response lost before commit"));
    fireEvent.click(screen.getByRole("button", { name: "削除する" }));
    await screen.findByRole("alert");
    fetchMock.mockResolvedValueOnce(json({ enabled: true, memories: [memory()] }));
    fireEvent.click(screen.getByRole("button", { name: "再読み込み" }));
    await waitFor(() =>
      expect(screen.queryByText("記憶を読み込んでいます…")).not.toBeInTheDocument(),
    );
    expect(screen.queryByText("好きな色は緑")).not.toBeInTheDocument();
    expect(screen.queryByText("次回の会話で利用可能")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "削除を再試行" })).toBeEnabled();
    fetchMock
      .mockResolvedValueOnce(json({ ok: true }))
      .mockResolvedValueOnce(
        json({ enabled: true, memories: [memory({ state: "deleted", content: "" })] }),
      );
    fireEvent.click(screen.getByRole("button", { name: "削除を再試行" }));
    expect(await screen.findByText("削除済み")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "削除を再試行" })).not.toBeInTheDocument();
    expect(screen.queryByText("好きな色は緑")).not.toBeInTheDocument();
  });

  it("marks an active enabled memory as ineligible when its source is no longer valid", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ enabled: true, memories: [memory({ eligible: false })] }),
    );
    render(<MemoryManager conversationId="conversation-1" />);
    expect(await screen.findByText("次回の会話では利用対象外")).toBeInTheDocument();
    expect(screen.getByText("好きな色は緑")).toBeInTheDocument();
    expect(screen.queryByText("次回の会話で利用可能")).not.toBeInTheDocument();
  });

  it("serializes a retained snapshot refresh with mutations and keeps failed commands retryable", async () => {
    let finishRefresh: ((response: Response) => void) | undefined;
    render(<MemoryManager conversationId="conversation-1" />);
    await screen.findByText("好きな色は緑");
    fetchMock.mockRejectedValueOnce(new TypeError("history offline"));
    fireEvent.click(screen.getByRole("button", { name: "履歴" }));
    await screen.findByRole("alert");
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRefresh = resolve;
        }),
    );
    fireEvent.click(screen.getByRole("button", { name: "再読み込み" }));
    expect(screen.getByText("記憶を読み込んでいます…")).toBeInTheDocument();
    expect(screen.getByLabelText("記憶を利用する")).toBeDisabled();
    fireEvent.click(screen.getByLabelText("記憶を利用する"));
    fireEvent.submit(screen.getByRole("form", { name: "記憶を追加" }));
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);

    finishRefresh?.(json({ enabled: true, memories: [memory()] }));
    await waitFor(() => expect(screen.getByLabelText("記憶を利用する")).toBeEnabled());
    expect(screen.queryByText("記憶を読み込んでいます…")).not.toBeInTheDocument();
    fetchMock.mockRejectedValueOnce(new TypeError("mutation offline"));
    fireEvent.click(screen.getByLabelText("記憶を利用する"));
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "再読み込み" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "操作を再試行" })).toBeEnabled();
    expect(screen.queryByText("記憶を読み込んでいます…")).not.toBeInTheDocument();

    fetchMock
      .mockResolvedValueOnce(json({ ok: true }))
      .mockResolvedValueOnce(json({ enabled: false, memories: [memory()] }));
    fireEvent.click(screen.getByRole("button", { name: "操作を再試行" }));
    await screen.findByText("保存済みの記憶は残ります。記憶の参照と自動追加を停止しています。");
    expect(screen.getByLabelText("記憶を利用する")).not.toBeChecked();
    await waitFor(() => expect(screen.getByLabelText("記憶を利用する")).toBeEnabled());
  });
});
