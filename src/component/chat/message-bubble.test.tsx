import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// sonner と apiFetch をモジュールレベルで mock し、handleDownload の 3 経路を分岐検証する。
const toastSuccess = vi.fn();
const toastInfo = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    info: (...args: unknown[]) => toastInfo(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

const apiFetchMock = vi.fn();
vi.mock("@/lib/api", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

import { MessageBubble } from "./message-bubble";

describe("MessageBubble", () => {
  afterEach(cleanup);

  it("XML actionをSaylo式の括弧ト書きとして表示する", () => {
    render(
      <MessageBubble
        id="m1"
        role="assistant"
        content="<response><action>結衣は息を詰め、指先に力が入る。</action><dialogue>「ねえ、こっち見て」</dialogue><inner>声が少し震える。</inner></response>"
        characterName="結衣"
      />,
    );

    expect(screen.getByText("（結衣は息を詰め、指先に力が入る。）")).toBeInTheDocument();
    expect(screen.getByText("「ねえ、こっち見て」")).toBeInTheDocument();
    expect(screen.getByText("声が少し震える。")).toBeInTheDocument();
  });

  it("半角括弧のactionを全角括弧に正規化して表示する", () => {
    render(
      <MessageBubble
        id="m2"
        role="assistant"
        content="<response><action>(小さく息を吸う)</action><dialogue>「…うん」</dialogue><inner>緊張してる。</inner></response>"
        characterName="結衣"
      />,
    );

    expect(screen.getByText("（小さく息を吸う）")).toBeInTheDocument();
  });

  it("全角括弧のactionは二重括弧にせず表示する", () => {
    render(
      <MessageBubble
        id="m3"
        role="assistant"
        content="<response><action>（静かに目を伏せる）</action><dialogue>「待ってた」</dialogue><inner>胸が少し高鳴る。</inner></response>"
        characterName="結衣"
      />,
    );

    expect(screen.getByText("（静かに目を伏せる）")).toBeInTheDocument();
    expect(screen.queryByText("（（静かに目を伏せる））")).not.toBeInTheDocument();
  });

  // 実測(2026-08-16 vlong-dogfood): モデルはaction/dialogueを交互に複数組出す。
  // 種別ごとにまとめて「地の文まとめ→台詞まとめ」の2段に描画すると、
  // モデルが書いた地の文→台詞→地の文→台詞…という場面の時系列が画面上で壊れる。
  it("action/dialogueが交互に複数組出た場合、出現順のまま表示する", () => {
    const { container } = render(
      <MessageBubble
        id="m-order"
        role="assistant"
        content="<response><action>アクション1</action><dialogue>台詞1</dialogue><action>アクション2</action><dialogue>台詞2</dialogue></response>"
        characterName="結衣"
      />,
    );

    const text = container.textContent ?? "";
    const idx1 = text.indexOf("アクション1");
    const idxD1 = text.indexOf("台詞1");
    const idx2 = text.indexOf("アクション2");
    const idxD2 = text.indexOf("台詞2");

    expect([idx1, idxD1, idx2, idxD2].every((i) => i >= 0)).toBe(true);
    expect(idx1).toBeLessThan(idxD1);
    expect(idxD1).toBeLessThan(idx2);
    expect(idx2).toBeLessThan(idxD2);
  });

  it("空のactionは括弧だけを表示しない", () => {
    const { container } = render(
      <MessageBubble
        id="m4"
        role="assistant"
        content="<response><action>   </action><dialogue>「うん」</dialogue><inner>少し落ち着く。</inner></response>"
        characterName="結衣"
      />,
    );

    expect(screen.queryByText("（）")).not.toBeInTheDocument();
    expect(container.querySelector(".narrative-action")).toBeNull();
    expect(within(container).getByText("「うん」")).toBeInTheDocument();
  });

  it("空白だけの括弧actionはaction段落を表示しない", () => {
    const { container } = render(
      <MessageBubble
        id="m5"
        role="assistant"
        content="<response><action>(   )</action><dialogue>「うん」</dialogue><inner>少し落ち着く。</inner></response>"
        characterName="結衣"
      />,
    );

    expect(screen.queryByText("（）")).not.toBeInTheDocument();
    expect(container.querySelector(".narrative-action")).toBeNull();
    expect(within(container).getByText("「うん」")).toBeInTheDocument();
  });

  it("フォールバック表示でも全角括弧のト書きをactionとして扱う", () => {
    const { container } = render(
      <MessageBubble
        id="m6"
        role="assistant"
        content="（小さく息を吸う）「うん」"
        characterName="結衣"
      />,
    );

    expect(within(container).getByText("（小さく息を吸う）")).toHaveClass(
      "italic",
      "text-muted-foreground/70",
      "text-[0.85em]",
    );
    expect(within(container).getByText("「うん」")).toHaveClass("font-medium");
  });

  it("assistantのストリーミング中だけthinking演出を表示する", () => {
    const { rerender } = render(
      <MessageBubble id="stream-1" role="assistant" content="" isStreaming characterName="結衣" />,
    );

    expect(screen.getByText("ことばを探している…")).toBeInTheDocument();

    rerender(<MessageBubble id="stream-1" role="assistant" content="「完了」" />);

    expect(screen.queryByText("ことばを探している…")).not.toBeInTheDocument();
  });

  it("品質メタ文言ではなく別案生成の案内を表示する", () => {
    render(
      <MessageBubble
        id="warn-1"
        role="assistant"
        content="「少し考えさせて」"
        isStreaming
        warningLevel
        characterName="結衣"
      />,
    );

    expect(screen.getByRole("button", { name: "別案生成の案内" })).toBeInTheDocument();
    expect(screen.getByText("別案あり")).toBeInTheDocument();
    expect(screen.queryByText("品質低下")).not.toBeInTheDocument();
  });

  describe("画像ダウンロード handleDownload", () => {
    // ALLOWED_IMAGE_HOSTS に含まれるホストを使い isValidImageUrl を通過させる。
    const validImageUrl = "https://image.novita.ai/test.png";

    beforeEach(() => {
      toastSuccess.mockReset();
      toastInfo.mockReset();
      toastError.mockReset();
      apiFetchMock.mockReset();
      // URL.createObjectURL / revokeObjectURL は jsdom に未実装なため stub する。
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        value: vi.fn(() => "blob:mock"),
      });
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        value: vi.fn(),
      });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    const setMobileTouch = (mobile: boolean): void => {
      // matchMedia と innerWidth を上書きして isMobileTouchDevice の挙動を制御する。
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: (query: string) => ({
          matches: mobile && query.includes("coarse"),
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }),
      });
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: mobile ? 390 : 1280,
      });
    };

    it("デスクトップ: blob 取得後に成功 toast が出る", async () => {
      setMobileTouch(false);
      const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
      apiFetchMock.mockResolvedValue({ ok: true, blob: async () => blob });

      render(
        <MessageBubble
          id="img-1"
          role="assistant"
          content="<response><dialogue>「見て」</dialogue></response>"
          imageUrl={validImageUrl}
        />,
      );

      const downloadBtn = screen.getByRole("button", { name: "AI生成画像をダウンロード" });
      fireEvent.click(downloadBtn);

      await waitFor(() => {
        expect(toastSuccess).toHaveBeenCalledWith(
          expect.stringContaining("ダウンロードフォルダに保存しました"),
        );
      });
    });

    it("モバイル: navigator.share が利用可能なら share() を呼び成功 toast が出る", async () => {
      setMobileTouch(true);
      const blob = new Blob([new Uint8Array([1])], { type: "image/png" });
      apiFetchMock.mockResolvedValue({ ok: true, blob: async () => blob });
      const shareSpy = vi.fn().mockResolvedValue(undefined);
      const canShareSpy = vi.fn().mockReturnValue(true);
      Object.defineProperty(navigator, "share", { configurable: true, value: shareSpy });
      Object.defineProperty(navigator, "canShare", {
        configurable: true,
        value: canShareSpy,
      });

      render(
        <MessageBubble
          id="img-2"
          role="assistant"
          content="<response><dialogue>「見せて」</dialogue></response>"
          imageUrl={validImageUrl}
        />,
      );

      // テスト間のクリーンアップ後にも稀に複数ヒットが残るため、最後のボタンを採用する。
      const buttons = screen.getAllByRole("button", { name: "AI生成画像をダウンロード" });
      fireEvent.click(buttons[buttons.length - 1]);

      await waitFor(() => {
        expect(shareSpy).toHaveBeenCalled();
        expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining("共有しました"));
      });
    });

    it("画像取得に失敗するとエラー toast が出る", async () => {
      setMobileTouch(false);
      apiFetchMock.mockResolvedValue({ ok: false });

      render(
        <MessageBubble
          id="img-3"
          role="assistant"
          content="<response><dialogue>「あれ」</dialogue></response>"
          imageUrl={validImageUrl}
        />,
      );

      // テスト間のクリーンアップ後にも稀に複数ヒットが残るため、最後のボタンを採用する。
      const buttons = screen.getAllByRole("button", { name: "AI生成画像をダウンロード" });
      fireEvent.click(buttons[buttons.length - 1]);

      await waitFor(() => {
        expect(toastError).toHaveBeenCalledWith("画像の取得に失敗しました");
      });
      expect(toastSuccess).not.toHaveBeenCalled();
    });
  });

  it("ローディング中は再試行ボタンを無効化する", () => {
    const onRetry = vi.fn();

    render(
      <MessageBubble
        id="retry-target"
        role="assistant"
        content=""
        error
        isLoading
        onRetry={onRetry}
      />,
    );

    const retryButton = screen.getByRole("button", { name: "再試行" });
    expect(retryButton).toBeDisabled();

    fireEvent.click(retryButton);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("メニュー内にGood/Bad評価を表示して選択できる", () => {
    const onFeedback = vi.fn();

    render(
      <MessageBubble
        id="feedback-target"
        role="assistant"
        content="評価対象"
        characterName="Sakura"
        feedbackRating="good"
        onFeedback={onFeedback}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "メッセージメニュー" }));

    expect(screen.getByRole("button", { name: "Good" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Bad" })).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByRole("button", { name: "Bad" }));
    // Bad クリック後は理由フォームが表示される
    expect(screen.getByPlaceholderText("例: AI臭い、キャラが崩れた…")).toBeInTheDocument();

    // 理由なしでスキップ → onFeedback が呼ばれる
    fireEvent.click(screen.getByRole("button", { name: "スキップ" }));
    expect(onFeedback).toHaveBeenCalledWith("feedback-target", "bad", undefined);
  });
});

// プロフィールアバターと会話生成画像のパス分離検証 (#323)
describe("generated image vs profile avatar path isolation", () => {
  beforeEach(() => {
    cleanup();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:mock"),
    });
    apiFetchMock.mockResolvedValue({ ok: false, status: 404 });
  });

  it("profile avatar URL as imageUrl renders no image (not a valid generated image path)", () => {
    render(
      <MessageBubble
        id="msg-1"
        role="assistant"
        content="こんにちは"
        imageUrl="/api/avatar/char-yarisa.jpg"
      />,
    );
    // /api/avatar/ パスは isValidImageUrl を通過しないので ImagePreview が null を返す
    expect(screen.queryAllByAltText("AIが生成したシーン画像")).toHaveLength(0);
  });

  it("R2 generated image URL renders the AI-generated image with correct alt text", async () => {
    apiFetchMock.mockRejectedValue(new Error("network error"));
    render(
      <MessageBubble
        id="msg-2"
        role="assistant"
        content="シーン画像"
        imageUrl="/api/image/r2/images/550e8400-e29b-41d4-a716-446655440000.png"
        nsfwBlur={false}
      />,
    );
    // /api/image/r2/ パスは isValidImageUrl を通過し ImagePreview が描画される
    // ネットワークエラーが resolve するまで待つ
    await waitFor(() => {
      expect(screen.getByText(/画像を読み込めません/)).toBeInTheDocument();
    });
  });

  it("static avatar path is not a valid generated image URL", () => {
    render(
      <MessageBubble
        id="msg-3"
        role="assistant"
        content="テスト"
        imageUrl="/avatars/char-yarisa-classmate.jpg"
      />,
    );
    expect(screen.queryAllByAltText("AIが生成したシーン画像")).toHaveLength(0);
  });

  it("progress_percent ありの生成中は確定プログレスバーを width で描画する", () => {
    render(
      <MessageBubble id="gen-1" role="assistant" content="画像を生成中... (45%)" isStreaming />,
    );

    const bar = screen.getByRole("progressbar", { name: "画像生成の進捗" });
    expect(bar).toHaveAttribute("aria-valuenow", "45");

    const fill = screen.getByTestId("image-progress-fill");
    expect(fill).toHaveStyle({ width: "45%" });
  });

  it("progress_percent なしの生成中は不定形バー（aria-valuenow なし）にフォールバックする", () => {
    render(<MessageBubble id="gen-2" role="assistant" content="画像を生成中..." isStreaming />);

    const bar = screen.getByRole("progressbar", { name: "画像生成の進捗" });
    expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(screen.queryByTestId("image-progress-fill")).not.toBeInTheDocument();
  });
});

// アバターの正規化は resolveAvatarSrc 一本に寄せる。以前この component 内に guard 抜きの
// 複製があり、保存キーを検証せず /api/avatar/ 配下へ素通ししとった。
describe("MessageBubble avatar key hardening", () => {
  // 直前の describe が cleanup を afterEach に持たんため、前テストの DOM を持ち越さんよう先に消す
  beforeEach(cleanup);
  afterEach(cleanup);

  const avatarRoot = () => document.querySelector('[data-slot="avatar"]');
  const srcAttributes = () =>
    Array.from(document.querySelectorAll("[src]")).map((el) => el.getAttribute("src") ?? "");

  it.each([
    ["path traversal", "../../../etc/passwd.png"],
    ["nested traversal", "avatars/../../secret.png"],
    ["null byte", "evil.png\0.txt"],
    ["no image extension", "not-an-image"],
  ])("rejects an unsafe avatar key (%s) instead of routing it to /api/avatar/", (_label, key) => {
    render(
      <MessageBubble
        id="avatar-unsafe"
        role="assistant"
        content="やあ"
        characterName="結衣"
        characterAvatar={key}
      />,
    );

    // 解決に失敗したアバターはクリック不可。原寸ビューアも開かん。
    const root = avatarRoot();
    expect(root).not.toBeNull();
    expect(root?.className).not.toContain("cursor-pointer");
    fireEvent.click(root as Element);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // どこにも /api/avatar/ の接頭辞から抜け出す URL を出さん
    for (const src of srcAttributes()) {
      expect(src).not.toContain("..");
      expect(src).not.toContain("%2E%2E");
      expect(src).not.toContain("\0");
    }
    expect(srcAttributes().filter((src) => src.includes("/api/avatar/"))).toHaveLength(0);
  });

  it("keeps a legitimate stored avatar key on the /api/avatar/ route", () => {
    render(
      <MessageBubble
        id="avatar-safe"
        role="assistant"
        content="やあ"
        characterName="結衣"
        characterAvatar="char-yui.webp"
      />,
    );

    const root = avatarRoot();
    expect(root?.className).toContain("cursor-pointer");

    fireEvent.click(root as Element);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByAltText("結衣")).toHaveAttribute("src", "/api/avatar/char-yui.webp");
  });
});
