import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DocumentPanel } from "./document-panel";

import type { DocumentItem } from "../lib/document-client";

const document = (enabled = true, status: DocumentItem["status"] = "ready"): DocumentItem => ({
  id: "synthetic-document",
  characterId: "synthetic-character",
  name: "fixture.txt",
  contentType: "text/plain",
  enabled,
  budgetChars: 2000,
  createdAt: 1,
  status,
});
const response = (documents: DocumentItem[] = [], budgetChars = 4000) =>
  Response.json({ documents, settings: { budgetChars } });
const props = { characterId: "synthetic-character", conversationId: "synthetic-conversation" };
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("document management panel", () => {
  it("does not infer a worldline or fetch before a persisted conversation is available", () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    render(<DocumentPanel characterId={props.characterId} conversationId={null} />);
    expect(screen.getByText("最初の会話後に資料を管理できます。")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uploads, switches OFF, saves individual/total bounds and deletes through the scoped API", async () => {
    const off = { ...document(false), budgetChars: 20 };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(response([document()]))
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce(response([document(false)]))
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce(response([off]))
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce(response([off], 100))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(response([], 100));
    render(<DocumentPanel {...props} />);
    expect(await screen.findByText("この会話に登録した資料はありません。")).toBeInTheDocument();
    expect(screen.getByText(/会話設定の残枠内で使用/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("TXTファイル（UTF-8、2 MiBまで）"), {
      target: { files: [new File(["合成資料"], "fixture.txt", { type: "text/plain" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "資料を取り込む" }));
    expect(await screen.findByText("資料を取り込みました。")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("fixture.txtを参照する"));
    expect(await screen.findByText("資料の参照をOFFにしました。")).toBeInTheDocument();
    expect(screen.getByLabelText("fixture.txtを参照する")).not.toBeChecked();
    fireEvent.change(screen.getByLabelText("fixture.txtの字数上限"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "字数を保存" }));
    expect(await screen.findByText("資料の字数上限を保存しました。")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("資料全体の字数上限"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "上限を保存" }));
    expect(await screen.findByText("資料全体の上限を保存しました。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "fixture.txtを削除" }));
    expect(await screen.findByText("資料を削除しました。")).toBeInTheDocument();
    expect(screen.queryByText("fixture.txt")).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.every(
        ([url]) =>
          url === "/api/chat/synthetic-character/documents?conversationId=synthetic-conversation",
      ),
    ).toBe(true);
    expect(
      fetchMock.mock.calls
        .filter(([, init]) => init?.method === "PATCH")
        .map(([, init]) => init?.body),
    ).toEqual([
      JSON.stringify({ documentId: "synthetic-document", enabled: false }),
      JSON.stringify({ documentId: "synthetic-document", budgetChars: 20 }),
      JSON.stringify({ budgetChars: 100 }),
    ]);
  });

  it("provides a real retry after list loading fails", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(response());
    render(<DocumentPanel {...props} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("再試行");
    fireEvent.click(screen.getByRole("button", { name: "資料を読み直す" }));
    expect(await screen.findByText("この会話に登録した資料はありません。")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("excludes mutations while a retry read is pending so a stale snapshot cannot roll them back", async () => {
    let release: (value: Response) => void = () => undefined;
    const retryRead = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(response([document()]))
      .mockResolvedValueOnce(
        Response.json({ message: "参照の変更を再試行してください" }, { status: 503 }),
      )
      .mockResolvedValueOnce(response([document()]))
      .mockReturnValueOnce(retryRead)
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce(response([document(false)]));
    render(<DocumentPanel {...props} />);
    fireEvent.click(await screen.findByLabelText("fixture.txtを参照する"));
    await screen.findByRole("alert");
    const checkbox = screen.getByLabelText("fixture.txtを参照する");
    await waitFor(() => expect(checkbox).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "資料を読み直す" }));
    expect(checkbox).toBeDisabled();
    fireEvent.click(checkbox);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1);
    await act(async () => release(response([document()])));
    await waitFor(() => expect(checkbox).toBeEnabled());
    fireEvent.click(checkbox);
    expect(await screen.findByText("資料の参照をOFFにしました。")).toBeInTheDocument();
    expect(checkbox).not.toBeChecked();
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual([
      "GET",
      "PATCH",
      "GET",
      "GET",
      "PATCH",
      "GET",
    ]);
  });

  it("shows a failed upload's pending row and permits deletion to recover its slot", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(
        Response.json(
          {
            code: "storage_failure",
            message: "取り込みと後片付けに失敗しました",
            documentId: "synthetic-document",
          },
          { status: 503 },
        ),
      )
      .mockResolvedValueOnce(response([document(true, "indexing")]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(response());
    render(<DocumentPanel {...props} />);
    await screen.findByText("この会話に登録した資料はありません。");
    fireEvent.change(screen.getByLabelText("TXTファイル（UTF-8、2 MiBまで）"), {
      target: { files: [new File(["合成資料"], "fixture.txt", { type: "text/plain" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "資料を取り込む" }));
    expect(
      await screen.findByText("取り込み中です。停止した場合は削除してやり直せます。"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("fixture.txtを参照する")).toBeDisabled();
    const remove = screen.getByRole("button", { name: "fixture.txtを削除" });
    await waitFor(() => expect(remove).toBeEnabled());
    fireEvent.click(remove);
    expect(await screen.findByText("資料を削除しました。")).toBeInTheDocument();
  });

  it("aborts the previous scope's pending list when the conversation changes", async () => {
    let release: (value: Response) => void = () => undefined;
    const previous = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockReturnValueOnce(previous)
      .mockResolvedValueOnce(response());
    const rendered = render(<DocumentPanel {...props} />);
    const oldSignal = fetchMock.mock.calls[0][1]?.signal;
    rendered.rerender(<DocumentPanel {...props} conversationId="other-persisted-conversation" />);
    expect(await screen.findByText("この会話に登録した資料はありません。")).toBeInTheDocument();
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => release(response([document()])));
    expect(screen.queryByText("fixture.txt")).not.toBeInTheDocument();
  });

  it("keeps a deletion retry available after the row is hidden but raw cleanup fails", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(response([document()]))
      .mockResolvedValueOnce(
        Response.json(
          {
            code: "storage_failure",
            message: "参照は停止しました。元資料の削除を再試行してください",
            documentId: "synthetic-document",
          },
          { status: 503 },
        ),
      )
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(response());
    render(<DocumentPanel {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: "fixture.txtを削除" }));
    const retry = await screen.findByRole("button", { name: "失敗した資料の削除を再試行" });
    await waitFor(() => expect(retry).toBeEnabled());
    expect(screen.queryByRole("heading", { name: "fixture.txt" })).not.toBeInTheDocument();
    fireEvent.click(retry);
    expect(await screen.findByText("資料を削除しました。")).toBeInTheDocument();
    expect(
      fetchMock.mock.calls
        .filter(([, init]) => init?.method === "DELETE")
        .map(([, init]) => init?.body),
    ).toEqual([
      JSON.stringify({ documentId: "synthetic-document" }),
      JSON.stringify({ documentId: "synthetic-document" }),
    ]);
  });
});
