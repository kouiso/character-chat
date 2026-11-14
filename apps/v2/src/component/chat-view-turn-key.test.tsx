import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatView } from "./chat-view";

const IMAGE_ROW = {
  id: "m-image",
  turn: 1,
  role: "assistant",
  content: "",
  imageUrl: "/api/media/m-image",
  mediaKind: "image",
};
const USER_ROW = { id: "m-user", turn: 2, role: "user", content: "二番目の発言" };
const REPLY_ROW = { id: "m-reply", turn: 2, role: "assistant", content: "その返事" };
const LAST_USER_ROW = { id: "m-last", turn: 3, role: "user", content: "三番目の発言" };

const FULL = [IMAGE_ROW, USER_ROW, REPLY_ROW, LAST_USER_ROW];
const WITHOUT_IMAGE = [USER_ROW, REPLY_ROW, LAST_USER_ROW];

const GALLERY_ENTRY = {
  messageId: "m-image",
  imageUrl: "/api/media/m-image",
  generationId: "g1",
  groupId: null,
  panelIndex: null,
  mediaKind: "image",
  turn: 1,
  createdAt: 100,
};

// 並びの位置がずれる操作（画像の削除）を、実際の画面操作どおりに通す。
type BackendState = { removed: boolean; switched: boolean; replied: boolean; truncated: unknown[] };
const newState = (): BackendState => ({
  removed: false,
  switched: false,
  replied: false,
  truncated: [],
});

const SWITCHED_REPLY_ROW = { ...REPLY_ROW, id: "m-reply-b", content: "別の枝の返事" };
const NEW_ROWS = [
  { id: "m-new-user", turn: 4, role: "user", content: "届いた質問" },
  { id: "m-new-reply", turn: 4, role: "assistant", content: "届いた返事" },
];

const historyOf = (state: BackendState) => {
  const base = state.removed ? WITHOUT_IMAGE : FULL;
  const rows = state.switched
    ? base.map((row) => (row === REPLY_ROW ? SWITCHED_REPLY_ROW : row))
    : base;
  return state.replied ? [...rows, ...NEW_ROWS] : rows;
};

const imagesResponse = (state: BackendState, init?: RequestInit) => {
  if (init?.method === "DELETE") {
    state.removed = true;
    return Response.json({ deleted: true });
  }
  return Response.json({ images: state.removed ? [] : [GALLERY_ENTRY] });
};

const siblingsOf = (state: BackendState, url: string) =>
  url.includes("role=assistant")
    ? [
        { id: "m-reply", branchNo: 1, active: !state.switched, content: "その返事" },
        { id: "m-reply-b", branchNo: 2, active: state.switched, content: "別の枝の返事" },
      ]
    : [{ id: "s", branchNo: 1, active: true, content: "二番目の発言" }];

const branchResponse = (state: BackendState, url: string, init?: RequestInit) => {
  if (init?.method !== "POST") return Response.json({ siblings: siblingsOf(state, url) });
  const body = JSON.parse(String(init.body)) as { action: string };
  if (body.action === "activate") state.switched = true;
  else state.truncated.push(body);
  return Response.json({ ok: true });
};

const sendResponse = (state: BackendState) => {
  state.replied = true;
  return new Response(
    'id: 1\nevent: done\ndata: {"conversationId":"conv","turn":4,"generationId":null}\n\n',
  );
};

const respond = (state: BackendState, url: string, init?: RequestInit): Response => {
  if (url.includes("/images")) return imagesResponse(state, init);
  if (url.includes("/branch")) return branchResponse(state, url, init);
  if (url.includes("/history")) {
    return Response.json({ turn: state.replied ? 5 : 4, history: historyOf(state) });
  }
  return init?.method === "POST" ? sendResponse(state) : Response.json({});
};

const stubBackend = (state: BackendState) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      respond(state, String(input), init),
    ),
  );

const openRewrite = async () => {
  const toggles = await screen.findAllByRole("button", { name: "枝操作" });
  // 並びは 画像 / 二番目の発言 / その返事 / 三番目の発言。2 つ目が「二番目の発言」。
  fireEvent.click(toggles[1]);
  fireEvent.click(await screen.findByRole("button", { name: "書き直す" }));
  return screen.findByRole("textbox", { name: "メッセージの書き直し" });
};

const turnRowOf = (element: HTMLElement) => element.closest<HTMLElement>(".v2-turn-row");

const removeFirstImage = async () => {
  fireEvent.click(screen.getByRole("button", { name: "画像履歴" }));
  fireEvent.click(await screen.findByRole("button", { name: "消す" }));
  fireEvent.click(await screen.findByRole("button", { name: "本当に消す" }));
  await waitFor(() => {
    expect(document.querySelector('[data-message-id="m-image"]')).toBeNull();
  });
};

describe("ChatView の発言の識別子", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("前の画像を消して並びが詰まっても、開いた書き直しは同じ発言に付いたまま", async () => {
    const state = newState();
    stubBackend(state);
    render(<ChatView characterId="a" characterName="案内役" initialConversationId="conv" />);
    const editor = await openRewrite();
    fireEvent.change(editor, { target: { value: "書きかけの下書き" } });
    expect(turnRowOf(editor)).toHaveTextContent("二番目の発言");

    await removeFirstImage();

    const after = screen.getByRole("textbox", { name: "メッセージの書き直し" });
    expect(after).toHaveValue("書きかけの下書き");
    const row = turnRowOf(after);
    expect(row).toHaveTextContent("二番目の発言");
    expect(row).not.toHaveTextContent("その返事");
    expect(
      within(row as HTMLElement).getByRole("button", { name: "書き直す" }),
    ).toBeInTheDocument();
  });

  it("詰まった後の「ここから戻る」は、開いた発言のターンから先だけを切り捨てる", async () => {
    const state = newState();
    stubBackend(state);
    render(<ChatView characterId="a" characterName="案内役" initialConversationId="conv" />);
    await openRewrite();

    await removeFirstImage();

    const row = turnRowOf(screen.getByRole("textbox", { name: "メッセージの書き直し" }));
    expect(row).toHaveTextContent("二番目の発言");
    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "ここから戻る" }));
    await waitFor(() => {
      expect(state.truncated).toEqual([
        { conversationId: "conv", action: "truncate", fromTurn: 2 },
      ]);
    });
  });

  // 位置がずれない操作でも、操作欄が同じ発言に付いたままである事を確かめる（失敗側の再現は
  // 画像削除のケースが担う）。

  it("枝を切り替えても、開いた書き直しは同じ発言に付いたまま", async () => {
    const state = newState();
    stubBackend(state);
    render(<ChatView characterId="a" characterName="案内役" initialConversationId="conv" />);
    const editor = await openRewrite();
    fireEvent.change(editor, { target: { value: "書きかけの下書き" } });

    const toggles = screen.getAllByRole("button", { name: "枝操作" });
    fireEvent.click(toggles[toggles.length - 2]);
    fireEvent.click(await screen.findByRole("button", { name: "次の枝" }));
    await screen.findByText("別の枝の返事");

    const after = screen.getByRole("textbox", { name: "メッセージの書き直し" });
    expect(after).toHaveValue("書きかけの下書き");
    expect(turnRowOf(after)).toHaveTextContent("二番目の発言");
  });

  it("新しい返信が届いて仮の発言が保存済みに置き換わっても、開いた書き直しは動かない", async () => {
    const state = newState();
    stubBackend(state);
    render(<ChatView characterId="a" characterName="案内役" initialConversationId="conv" />);
    const editor = await openRewrite();
    fireEvent.change(editor, { target: { value: "書きかけの下書き" } });

    fireEvent.change(screen.getByRole("textbox", { name: "メッセージ" }), {
      target: { value: "届いた質問" },
    });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));
    await screen.findByText("届いた返事");

    const after = screen.getByRole("textbox", { name: "メッセージの書き直し" });
    expect(after).toHaveValue("書きかけの下書き");
    expect(turnRowOf(after)).toHaveTextContent("二番目の発言");
  });
});
