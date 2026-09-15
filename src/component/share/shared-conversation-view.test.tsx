import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SharedConversation } from "@/lib/api";

// @/lib/api をモジュールレベルで mock し、fetchSharedConversation の戻り値を固定する。
// vi.mock は巻き上げられるため、mock 関数は vi.hoisted で先に確保し、
// ApiResponseError（viewer が instanceof 分岐に使う）は factory 内で定義する。
const { fetchSharedConversationMock } = vi.hoisted(() => ({
  fetchSharedConversationMock: vi.fn(),
}));
vi.mock("@/lib/api", () => {
  class ApiResponseError extends Error {
    readonly status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = "ApiResponseError";
      this.status = status;
    }
  }
  return {
    ApiResponseError,
    fetchSharedConversation: (...args: unknown[]) => fetchSharedConversationMock(...args),
  };
});

import { SharedConversationView } from "./shared-conversation-view";

const buildSnapshot = (): SharedConversation => ({
  shareId: "share-1",
  createdAt: 0,
  payload: {
    conversationId: "conv-1",
    title: "テスト会話",
    character: { id: "char-1", name: "結衣", avatar: null },
    messages: [
      { id: "msg-1", role: "user", content: "ひとつめ", imageUrl: null, createdAt: 1 },
      { id: "msg-2", role: "assistant", content: "ふたつめ", imageUrl: null, createdAt: 2 },
      { id: "msg-3", role: "user", content: "みっつめ", imageUrl: null, createdAt: 3 },
    ],
    now: 10,
  },
});

describe("SharedConversationView deep-link", () => {
  let scrollIntoView: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSharedConversationMock.mockReset();
    // jsdom は scrollIntoView を実装しないため stub する。呼び出し検証にも使う。
    scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView as unknown as Element["scrollIntoView"];
  });

  afterEach(() => {
    cleanup();
  });

  it("focusMessageId で指定された発言までスクロールしハイライトする", async () => {
    fetchSharedConversationMock.mockResolvedValue(buildSnapshot());

    render(<SharedConversationView shareId="share-1" focusMessageId="msg-2" />);

    // 読み込み完了を待つ（対象の発言が描画される）
    await waitFor(() => expect(screen.getByText("ふたつめ")).toBeInTheDocument());

    const target = document.querySelector("#msg-msg-2");
    expect(target).not.toBeNull();

    // スクロール対象ノードで scrollIntoView が呼ばれる
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));

    // 対象だけが一時ハイライト（data-flash）され、他の発言は対象外
    await waitFor(() => expect(target?.getAttribute("data-flash")).toBe("true"));
    expect(document.querySelector("#msg-msg-1")?.getAttribute("data-flash")).toBeNull();
    // ハイライト用の ring クラスが対象バブルに付与される
    expect(target?.querySelector(".ring-2")).not.toBeNull();
  });

  it("focusMessageId が無い場合はスクロールもハイライトもしない", async () => {
    fetchSharedConversationMock.mockResolvedValue(buildSnapshot());

    render(<SharedConversationView shareId="share-1" />);

    await waitFor(() => expect(screen.getByText("ふたつめ")).toBeInTheDocument());
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(document.querySelector("#msg-msg-2")?.getAttribute("data-flash")).toBeNull();
  });

  it("snapshot に無い focusMessageId は黙ってスキップする", async () => {
    fetchSharedConversationMock.mockResolvedValue(buildSnapshot());

    render(<SharedConversationView shareId="share-1" focusMessageId="msg-does-not-exist" />);

    await waitFor(() => expect(screen.getByText("ふたつめ")).toBeInTheDocument());
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("キャラ発言のXMLタグを生表示せず、各セクションの本文だけを描画する", async () => {
    const snapshot = buildSnapshot();
    snapshot.payload.messages = [
      {
        id: "msg-xml",
        role: "assistant",
        content:
          "<response><action>軽く笑う</action><dialogue>あら、こんにちは</dialogue><inner>ドキドキする</inner></response>",
        imageUrl: null,
        createdAt: 1,
      },
    ];
    fetchSharedConversationMock.mockResolvedValue(snapshot);

    render(<SharedConversationView shareId="share-1" />);

    await waitFor(() => expect(screen.getByText("あら、こんにちは")).toBeInTheDocument());
    expect(screen.getByText("軽く笑う")).toBeInTheDocument();
    expect(screen.getByText("ドキドキする")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("<response>");
    expect(document.body.textContent).not.toContain("<dialogue>");
    expect(document.body.textContent).not.toContain("<action>");
    expect(document.body.textContent).not.toContain("<inner>");
  });

  it("XML構造を持たないプレーンなキャラ発言はそのまま表示する", async () => {
    const snapshot = buildSnapshot();
    snapshot.payload.messages = [
      {
        id: "msg-plain",
        role: "assistant",
        content: "ふつうの返事だよ",
        imageUrl: null,
        createdAt: 1,
      },
    ];
    fetchSharedConversationMock.mockResolvedValue(snapshot);

    render(<SharedConversationView shareId="share-1" />);

    await waitFor(() => expect(screen.getByText("ふつうの返事だよ")).toBeInTheDocument());
  });
});

// アバターの正規化は resolveAvatarSrc 一本に寄せる。以前この component 内に guard 抜きの
// 複製があり、共有スナップショット由来のキーを検証せず /api/avatar/ 配下へ素通ししとった。
describe("SharedConversationView avatar key hardening", () => {
  beforeEach(() => {
    fetchSharedConversationMock.mockReset();
  });

  afterEach(cleanup);

  const renderWithAvatar = async (avatar: string) => {
    const snapshot = buildSnapshot();
    snapshot.payload.character.avatar = avatar;
    fetchSharedConversationMock.mockResolvedValue(snapshot);

    render(<SharedConversationView shareId="share-1" />);
    await waitFor(() => expect(screen.getByText("ふたつめ")).toBeInTheDocument());
  };

  it.each([
    ["path traversal", "../../../etc/passwd.png"],
    ["nested traversal", "avatars/../../secret.png"],
    ["null byte", "evil.png\0.txt"],
    ["no image extension", "not-an-image"],
  ])(
    "rejects an unsafe avatar key (%s) instead of routing it to /api/avatar/",
    async (_label, key) => {
      await renderWithAvatar(key);

      // /api/avatar/ の接頭辞から抜け出す URL を一切描画せん
      const sources = Array.from(document.querySelectorAll("[src]")).map(
        (el) => el.getAttribute("src") ?? "",
      );
      for (const src of sources) {
        expect(src).not.toContain("..");
        expect(src).not.toContain("%2E%2E");
        expect(src).not.toContain("\0");
      }
      expect(sources.filter((src) => src.includes("/api/avatar/"))).toHaveLength(0);

      // 解決に失敗したらイニシャルのフォールバックへ落とす
      expect(screen.getAllByText("結").length).toBeGreaterThan(0);
    },
  );

  it("keeps a legitimate stored avatar key on the /api/avatar/ route", async () => {
    await renderWithAvatar("char-yui.webp");

    const sources = Array.from(document.querySelectorAll("img")).map((el) =>
      el.getAttribute("src"),
    );
    expect(sources).toContain("/api/avatar/char-yui.webp");
  });
});
