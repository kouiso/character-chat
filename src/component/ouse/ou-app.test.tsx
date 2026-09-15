import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "@/lib/api";
import { QUOTA_EXCEEDED_EVENT } from "@/lib/api";
import type { AppRoute } from "@/lib/app-route";
import { useCharacterSettingsStore } from "@/store/character-settings-store";
import { useChatStore } from "@/store/chat-store";
import { useSettingsStore } from "@/store/settings-store";

import { OuApp } from "./ou-app";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof api>();
  return {
    ...actual,
    listCharacters: vi.fn(),
    listConversations: vi.fn(),
    listConversationMessages: vi.fn(),
    streamChatWithQualityGuard: vi.fn(),
    updateMessageContent: vi.fn(),
    createConversationMessage: vi.fn(),
    generateImage: vi.fn(),
    getImageTaskResult: vi.fn(),
    persistImageToR2: vi.fn(),
    updateMessageImage: vi.fn(),
    fetchCurrentUser: vi.fn(),
    updateMyDisplayName: vi.fn(),
  };
});

const CHARACTER = {
  id: "char-1",
  userId: "user-1",
  name: "テスト",
  avatar: null,
  systemPrompt: "テスト用",
  greeting: "",
  tags: [],
  createdAt: 0,
};

const CONVERSATION = {
  id: "conv-1",
  title: "テスト会話",
  createdAt: 0,
  updatedAt: 0,
  characterId: "char-1",
  characterName: "テスト",
  characterGreeting: "",
  characterSystemPrompt: "テスト用",
  characterAvatar: null,
};

const ASSISTANT_MESSAGE = {
  id: "msg-1",
  role: "assistant" as const,
  content: "<response><dialogue>「まえの返事」</dialogue></response>",
  createdAt: 1,
};

const IMAGE_MESSAGE = {
  id: "msg-2",
  role: "assistant" as const,
  content: "<response><dialogue>「写真やで」</dialogue></response>",
  imageUrl: "https://example.com/photo.png",
  createdAt: 2,
};

// jsdom には matchMedia が無い。PC レイアウト分岐を mobile 側に固定して描画経路を1本にする。
const stubMatchMedia = () => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
};

const renderOuApp = (
  route: AppRoute = { page: "chat", characterId: "char-1", conversationId: "conv-1" },
) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<OuApp route={route} />, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
};

describe("OuApp regenerate persistence", () => {
  beforeEach(() => {
    vi.mocked(api.listCharacters).mockResolvedValue([CHARACTER]);
    vi.mocked(api.listConversations).mockResolvedValue([CONVERSATION]);
    vi.mocked(api.listConversationMessages).mockResolvedValue([ASSISTANT_MESSAGE]);
    stubMatchMedia();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useChatStore.setState({
      messages: [],
      currentConversationId: null,
      activeCharacterId: null,
      offlineQueue: [],
      isLoading: false,
    });
  });

  // 再生成の PATCH が落ちたのに黙って閉じると、画面は新しい返事、D1 は古い返事のままになり、
  // 再読込で初めて消えたことに気づく。失敗は必ず知らせる。
  it("再生成の保存に失敗したら知らせ、送信ロックも解く", async () => {
    const errorToast = vi.spyOn(toast, "error");
    vi.mocked(api.updateMessageContent).mockRejectedValue(new Error("patch failed"));
    vi.mocked(api.streamChatWithQualityGuard).mockImplementation(
      async (_messages, _model, _onChunk, onDone) => {
        onDone({ content: "<response><dialogue>「あたらしい返事」</dialogue></response>" });
      },
    );

    renderOuApp();

    const regenerate = await screen.findByRole("button", { name: "再生成" });
    fireEvent.click(regenerate);

    await waitFor(() => {
      expect(errorToast).toHaveBeenCalled();
    });
    expect(vi.mocked(api.updateMessageContent)).toHaveBeenCalledWith(
      "msg-1",
      "<response><dialogue>「あたらしい返事」</dialogue></response>",
    );
    await waitFor(() => {
      expect(useChatStore.getState().isLoading).toBe(false);
    });
  });

  it("再生成の保存が成功したら何も知らせない", async () => {
    const errorToast = vi.spyOn(toast, "error");
    vi.mocked(api.updateMessageContent).mockResolvedValue(undefined);
    vi.mocked(api.streamChatWithQualityGuard).mockImplementation(
      async (_messages, _model, _onChunk, onDone) => {
        onDone({ content: "<response><dialogue>「あたらしい返事」</dialogue></response>" });
      },
    );

    renderOuApp();

    const regenerate = await screen.findByRole("button", { name: "再生成" });
    fireEvent.click(regenerate);

    await waitFor(() => {
      expect(vi.mocked(api.updateMessageContent)).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(useChatStore.getState().isLoading).toBe(false);
    });
    expect(errorToast).not.toHaveBeenCalled();
  });
});

// 拡大表示のハンドラは StageBody が自分の state から作る。props バッグ側にも同名の枠が
// 在った頃は、受け渡しの順番が変わるだけで何も起きん何かに差し替わり、画像タップが
// 黙って死ぬ形になっとった。実際にタップして全画面が開くところまでを固定する。
describe("OuApp 会話内の画像", () => {
  beforeEach(() => {
    vi.mocked(api.listCharacters).mockResolvedValue([CHARACTER]);
    vi.mocked(api.listConversations).mockResolvedValue([CONVERSATION]);
    vi.mocked(api.listConversationMessages).mockResolvedValue([ASSISTANT_MESSAGE, IMAGE_MESSAGE]);
    stubMatchMedia();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useChatStore.setState({
      messages: [],
      currentConversationId: null,
      activeCharacterId: null,
      offlineQueue: [],
      isLoading: false,
    });
  });

  it("画像をタップしたら全画面ビューアが開く", async () => {
    renderOuApp();

    const zoom = await screen.findByRole("button", { name: "画像を拡大" });
    expect(screen.queryByRole("dialog", { name: "写真・全画面" })).toBeNull();

    fireEvent.click(zoom);

    expect(await screen.findByRole("dialog", { name: "写真・全画面" })).toBeTruthy();
  });
});

// 「この子との設定」が送信まで届いているかは、画面の見た目では分からん。全体設定と
// 違う値をこの子だけに入れて送り、api の境界（streamChatWithQualityGuard の引数と
// generateImage の呼び出し有無）で実際に観測された値を固定する。
// ou-app が activeCharId ではなく null でこの設定を読むと、全体設定が使われてここが落ちる。
describe("OuApp この子との設定が送信まで届く", () => {
  // streamChatWithQualityGuard は位置引数で、8 番目が返事の長さ（src/lib/api.ts の署名）。
  const RESPONSE_LENGTH_ARG = 7;

  // 以前は「続き」チップを押して送信させとった。そのチップは 2026-08-17 に YAGNI で
  // 撤去したので、実ユーザーと同じ経路——入力欄へ書いて送信を押す——で送る。
  // chatscope の入力は contenteditable なので、textContent を入れて input を撃つ。
  const sendViaComposer = async () => {
    renderOuApp();
    const editor = await screen.findByLabelText(`${CHARACTER.name}へのメッセージ入力`);
    editor.textContent = "つづきを聞かせて";
    fireEvent.input(editor);
    const sendButton = await screen.findByLabelText("送信");
    fireEvent.click(sendButton);
  };

  beforeEach(() => {
    // 呼び出し履歴は describe をまたいで積み上がる。消さんと mock.calls[0] が
    // 前の describe の再生成の呼び出しを指し、この describe の主張が別の送信で通ってまう。
    vi.clearAllMocks();
    localStorage.clear();
    useCharacterSettingsStore.setState({ byCharacter: {} });
    useSettingsStore.setState({ responseLength: "short", autoGenerateImages: false });
    vi.mocked(api.listCharacters).mockResolvedValue([CHARACTER]);
    vi.mocked(api.listConversations).mockResolvedValue([CONVERSATION]);
    vi.mocked(api.listConversationMessages).mockResolvedValue([ASSISTANT_MESSAGE]);
    vi.mocked(api.createConversationMessage).mockResolvedValue(undefined);
    vi.mocked(api.generateImage).mockResolvedValue({ error: "テスト用に生成させない" });
    stubMatchMedia();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useChatStore.setState({
      messages: [],
      currentConversationId: null,
      activeCharacterId: null,
      offlineQueue: [],
      isLoading: false,
    });
    useCharacterSettingsStore.setState({ byCharacter: {} });
    useSettingsStore.setState({ responseLength: "medium", autoGenerateImages: false });
  });

  it("この子だけの文章の長さが /api/chat の引数に乗る", async () => {
    vi.mocked(api.streamChatWithQualityGuard).mockResolvedValue(undefined);
    useCharacterSettingsStore.getState().patch(CHARACTER.id, { responseLength: "very_long" });

    await sendViaComposer();

    await waitFor(() => {
      expect(vi.mocked(api.streamChatWithQualityGuard)).toHaveBeenCalled();
    });
    const call = vi.mocked(api.streamChatWithQualityGuard).mock.calls[0];
    expect(call[RESPONSE_LENGTH_ARG]).toBe("very_long");
  });

  it("全体設定は他の子にだけ残る（この子の値で上書きされん）", async () => {
    vi.mocked(api.streamChatWithQualityGuard).mockResolvedValue(undefined);
    useCharacterSettingsStore.getState().patch("character-2", { responseLength: "very_long" });

    await sendViaComposer();

    await waitFor(() => {
      expect(vi.mocked(api.streamChatWithQualityGuard)).toHaveBeenCalled();
    });
    const call = vi.mocked(api.streamChatWithQualityGuard).mock.calls[0];
    expect(call[RESPONSE_LENGTH_ARG]).toBe("short");
  });

  it("この子だけの写真を混ぜる ON で、全体設定 OFF でも画像生成が走る", async () => {
    vi.mocked(api.streamChatWithQualityGuard).mockImplementation(
      async (_messages, _model, _onChunk, onDone) => {
        onDone({ content: "<response><dialogue>「ええよ」</dialogue></response>" });
      },
    );
    useCharacterSettingsStore.getState().patch(CHARACTER.id, { photoMix: true });

    await sendViaComposer();

    await waitFor(
      () => {
        expect(vi.mocked(api.generateImage)).toHaveBeenCalled();
      },
      { timeout: 5000 },
    );
  });

  // G1: 画像が場面と一致せんかった原因。conversationId を渡してへんかったので
  // サーバの resolveSceneBackground が conversation_scene_state を読む分岐へ一度も
  // 入れず、舞台は直近 3 往復のテキストからの推測だけで決まっとった。
  it("画像生成に会話 id を渡す", async () => {
    vi.mocked(api.streamChatWithQualityGuard).mockImplementation(
      async (_messages, _model, _onChunk, onDone) => {
        onDone({ content: "<response><dialogue>「ええよ」</dialogue></response>" });
      },
    );
    useCharacterSettingsStore.getState().patch(CHARACTER.id, { photoMix: true });

    await sendViaComposer();

    await waitFor(
      () => {
        expect(vi.mocked(api.generateImage)).toHaveBeenCalled();
      },
      { timeout: 5000 },
    );
    const CONVERSATION_ID_ARG = 4;
    const call = vi.mocked(api.generateImage).mock.calls[0];
    expect(call[CONVERSATION_ID_ARG]).toBeTruthy();
  });

  it("この子だけの文章のみモードで、全体設定 ON でも画像生成が走らん", async () => {
    useSettingsStore.setState({ autoGenerateImages: true });
    vi.mocked(api.streamChatWithQualityGuard).mockImplementation(
      async (_messages, _model, _onChunk, onDone) => {
        onDone({ content: "<response><dialogue>「ええよ」</dialogue></response>" });
      },
    );
    useCharacterSettingsStore.getState().patch(CHARACTER.id, { textOnly: true });

    await sendViaComposer();

    await waitFor(() => {
      expect(vi.mocked(api.streamChatWithQualityGuard)).toHaveBeenCalled();
    });
    // 画像生成は返信確定の 700ms 後に走る。走らんことを見るには、その窓を越えてから確かめる。
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(vi.mocked(api.generateImage)).not.toHaveBeenCalled();
  });

  // 写真の頻度スライダーはこれまで誰にも読まれておらず、ひかえめ側へ寄せても
  // 返事のたびに生成されて課金が乗り続けとった。
  it("R2 保存失敗時は D1 に書かず、表示だけ維持して通知する", async () => {
    const errorToast = vi.spyOn(toast, "error");
    vi.mocked(api.streamChatWithQualityGuard).mockImplementation(
      async (_messages, _model, _onChunk, onDone) => {
        onDone({ content: "<response><dialogue>「ええよ」</dialogue></response>" });
      },
    );
    vi.mocked(api.generateImage).mockResolvedValue({ task_id: "task-1" });
    vi.mocked(api.getImageTaskResult).mockResolvedValue({
      task: {
        task_id: "task-1",
        status: "TASK_STATUS_SUCCEED",
        progress_percent: 100,
      },
      images: [{ image_url: "https://example.com/upstream.png" }],
    });
    vi.mocked(api.persistImageToR2).mockResolvedValue({ error: "R2 persist failed: 502" });
    useCharacterSettingsStore.getState().patch(CHARACTER.id, { photoMix: true });

    await sendViaComposer();

    await waitFor(
      () => {
        expect(vi.mocked(api.persistImageToR2)).toHaveBeenCalled();
      },
      { timeout: 5000 },
    );
    expect(vi.mocked(api.updateMessageImage)).not.toHaveBeenCalled();
    expect(errorToast).toHaveBeenCalled();
    await waitFor(
      () => {
        expect(
          useChatStore
            .getState()
            .messages.some((m) => m.imageUrl === "https://example.com/upstream.png"),
        ).toBe(true);
      },
      { timeout: 1000 },
    );
  });

  it("写真の頻度をひかえめいっぱいにすると画像生成が走らん", async () => {
    useSettingsStore.setState({ autoGenerateImages: true });
    vi.mocked(api.streamChatWithQualityGuard).mockImplementation(
      async (_messages, _model, _onChunk, onDone) => {
        onDone({ content: "<response><dialogue>「ええよ」</dialogue></response>" });
      },
    );
    useCharacterSettingsStore.getState().patch(CHARACTER.id, { photoFrequency: 0 });

    await sendViaComposer();

    await waitFor(() => {
      expect(vi.mocked(api.streamChatWithQualityGuard)).toHaveBeenCalled();
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(vi.mocked(api.generateImage)).not.toHaveBeenCalled();
  });

  // シートは「会話中のチップからも変えられます」と謳っとる。composer に渡すキャラが
  // 抜けるとチップだけが全体設定を書き、シートで長さを決めた子でチップが無反応になる。
  it("会話中のチップはこの子との設定を読み書きする", async () => {
    useSettingsStore.setState({ responseLength: "medium" });
    useCharacterSettingsStore.getState().patch(CHARACTER.id, { responseLength: "very_long" });

    renderOuApp();

    const lengthChip = await screen.findByRole("button", { name: /^ことば/ });
    expect(lengthChip.textContent).toContain("たっぷり");

    fireEvent.click(lengthChip);

    expect(useCharacterSettingsStore.getState().byCharacter[CHARACTER.id]?.responseLength).toBe(
      "short",
    );
    // 全体の既定値も一緒に動く。設定画面のグローバルな「ことばの量」は devMode の中で
    // 普段は出てこんので、この子だけに書くと未設定の子の既定を変える手段が無くなる。
    expect(useSettingsStore.getState().responseLength).toBe("short");
  });
});

// ルート遷移（ブラウザ戻る/進む・別画面）で返信設定シート・記録ドロワーが開いたまま残ると、
// 前の画面の UI が新しい画面に重なって操作を奪う。
describe("OuApp ルート遷移で一時シートを閉じる", () => {
  beforeEach(() => {
    vi.mocked(api.listCharacters).mockResolvedValue([CHARACTER]);
    vi.mocked(api.listConversations).mockResolvedValue([CONVERSATION]);
    vi.mocked(api.listConversationMessages).mockResolvedValue([ASSISTANT_MESSAGE]);
    stubMatchMedia();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useChatStore.setState({
      messages: [],
      currentConversationId: null,
      activeCharacterId: null,
      offlineQueue: [],
      isLoading: false,
    });
  });

  it("別ルートへ遷移したら返信設定シートと記録ドロワーを閉じる", async () => {
    const { rerender } = renderOuApp();

    const menu = await screen.findByRole("button", { name: "メニューを開く" });
    fireEvent.click(menu);

    // 返信設定シートが開いたことを確認（Popup は role="dialog" を持つ）
    await screen.findByRole("dialog");

    const openRecords = await screen.findByRole("button", { name: /ふたりの記録/ });
    fireEvent.click(openRecords);

    // 記録ドロワーが開く（tablist で確認）
    expect(await screen.findByRole("tablist", { name: "ふたりの抽斗" })).toBeInTheDocument();

    rerender(<OuApp route={{ page: "chat", characterId: "char-1", conversationId: "conv-2" }} />);

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.queryByRole("tablist", { name: "ふたりの抽斗" })).not.toBeInTheDocument();
    });
  });
});

// オフライン時の送信・再送で、自分の発言と返事の ID が変わらんように引き継ぐ。
// ID が変わると、再送が元の POST と別行として重複し、会話履歴が二重になる。
describe("OuApp オフライン送信の ID 引継ぎ", () => {
  const stubNavigatorOnLine = (online: boolean) => {
    Object.defineProperty(window, "navigator", {
      value: { ...window.navigator, onLine: online },
      configurable: true,
    });
  };

  beforeEach(() => {
    vi.mocked(api.listCharacters).mockResolvedValue([CHARACTER]);
    vi.mocked(api.listConversations).mockResolvedValue([CONVERSATION]);
    vi.mocked(api.listConversationMessages).mockResolvedValue([ASSISTANT_MESSAGE]);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    stubNavigatorOnLine(false);
    stubMatchMedia();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    stubNavigatorOnLine(true);
    useChatStore.setState({
      messages: [],
      currentConversationId: null,
      activeCharacterId: null,
      offlineQueue: [],
      isLoading: false,
    });
  });

  it("オフライン送信は sendFailed/offlineQueued でキューに積み、ID を再送時に引き継ぐ", async () => {
    renderOuApp();

    // chatscope の MessageInput は contenteditable な div。keydown ではなく input イベントで状態更新する。
    const editor = await screen.findByRole("textbox", { name: /メッセージ入力/ });
    editor.innerHTML = "届かん言葉";
    fireEvent.input(editor);

    const send = await screen.findByRole("button", { name: "送信" });
    await waitFor(() => expect(send).not.toBeDisabled());
    fireEvent.click(send);

    await waitFor(() => {
      const queued = useChatStore.getState().messages.find((m) => m.content === "届かん言葉");
      expect(queued).toBeDefined();
      expect(queued?.sendFailed).toBe(true);
      expect(queued?.offlineQueued).toBe(true);
      expect(queued?.retryAssistantId).toBeDefined();
    });

    const firstQueued = useChatStore.getState().messages.find((m) => m.content === "届かん言葉")!;
    const originalId = firstQueued.id;
    const originalAssistantId = firstQueued.retryAssistantId;

    // 未送達バブル（タップで再送ボタン）をクリック
    const bubble = await screen.findByRole("button", { name: /届かん言葉.*タップで再送/ });
    fireEvent.click(bubble);

    await waitFor(() => {
      const retried = useChatStore.getState().messages.find((m) => m.content === "届かん言葉");
      expect(retried).toBeDefined();
      expect(retried?.id).toBe(originalId);
      expect(retried?.retryAssistantId).toBe(originalAssistantId);
      expect(retried?.sendFailed).toBe(true);
      expect(retried?.offlineQueued).toBe(true);
    });
  });
});

// ホームの「つづきから」のカードは、遷移が履歴の読み込みの後ろに置かれとったため、
// 会話が D1 から消えとる（別端末で削除・履歴の全消し）と await が 404 で落ちて
// 遷移まで届かず、カードが完全に無反応になっとった（unhandled rejection だけが出て
// トーストも画面遷移も無し）。会話一覧は IndexedDB に24時間残るので、消えた会話の
// カードは refetch が届くまで画面に出たままになる。
describe("OuApp home つづきから", () => {
  const ROW_NAME = "テストとの会話を開く";

  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, "", "/");
    vi.mocked(api.listCharacters).mockResolvedValue([CHARACTER]);
    vi.mocked(api.listConversations).mockResolvedValue([CONVERSATION]);
    stubMatchMedia();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
    useChatStore.setState({
      messages: [],
      currentConversationId: null,
      activeCharacterId: null,
      offlineQueue: [],
      isLoading: false,
    });
  });

  it("会話がサーバから消えとってもタップで遷移し、死んだカードを一覧から外す", async () => {
    const errorToast = vi.spyOn(toast, "error");
    vi.mocked(api.listConversationMessages).mockRejectedValue(
      new api.ApiResponseError("list messages failed", 404),
    );

    renderOuApp({ page: "home" });

    fireEvent.click(await screen.findByRole("button", { name: ROW_NAME }));

    await waitFor(() => expect(window.location.pathname).toBe("/chat/char-1"));
    await waitFor(() => expect(screen.queryByRole("button", { name: ROW_NAME })).toBeNull());
    expect(errorToast).toHaveBeenCalled();
    // 消えた会話の id を握ったままやと、次の送信が保存でだけ 404 になる。手放す。
    expect(useChatStore.getState().currentConversationId).toBeNull();
  });

  // URL からの復元は `void restoreConversation(...)` で呼ばれる。消えた会話への
  // 直リンク・ブックマークも同じ形で黙って落ちとった（unhandled rejection だけ）。
  it("消えた会話への直リンクは知らせて会話 id を手放す", async () => {
    const errorToast = vi.spyOn(toast, "error");
    vi.mocked(api.listConversationMessages).mockRejectedValue(
      new api.ApiResponseError("list messages failed", 404),
    );

    renderOuApp({ page: "chat", characterId: "char-1", conversationId: "conv-1" });

    await waitFor(() => expect(errorToast).toHaveBeenCalled());
    await waitFor(() => expect(useChatStore.getState().currentConversationId).toBeNull());
  });

  it("履歴が読めた時はタップで会話が開く", async () => {
    vi.mocked(api.listConversationMessages).mockResolvedValue([ASSISTANT_MESSAGE]);

    renderOuApp({ page: "home" });

    fireEvent.click(await screen.findByRole("button", { name: ROW_NAME }));

    await waitFor(() => expect(window.location.pathname).toBe("/chat/char-1"));
    expect(window.location.search).toContain("conv=conv-1");
    await waitFor(() => expect(screen.getByRole("button", { name: ROW_NAME })).toBeTruthy());
    await waitFor(() =>
      expect(useChatStore.getState().messages.some((m) => m.id === ASSISTANT_MESSAGE.id)).toBe(
        true,
      ),
    );
  });
});

// 遷移を履歴の読み込みより先にした副作用。talk 画面は messages が空のまま先に出るので、
// 「まだ一言も打っとらん会話」と見分けが付かん一瞬がある。名前を尋ねるシートはその窓で
// 開くと、既に話し込んどる会話の上に居座る（閉じる契機が無い）。
describe("OuApp 履歴の到着前に名前シートを出さない", () => {
  const GREETING_CHARACTER = { ...CHARACTER, greeting: "おかえりなさい" };
  const GREETING_CONVERSATION = { ...CONVERSATION, characterGreeting: "おかえりなさい" };
  const USER_MESSAGE = {
    id: "msg-u1",
    role: "user" as const,
    content: "ただいま",
    createdAt: 1,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, "", "/");
    vi.mocked(api.listCharacters).mockResolvedValue([GREETING_CHARACTER]);
    vi.mocked(api.listConversations).mockResolvedValue([GREETING_CONVERSATION]);
    vi.mocked(api.fetchCurrentUser).mockResolvedValue({
      email: "x@example.com",
      logoutUrl: null,
      isLocal: true,
      displayName: null,
    });
    stubMatchMedia();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
    localStorage.removeItem("ou_name_prompt_asked");
    useChatStore.setState({
      messages: [],
      currentConversationId: null,
      activeCharacterId: null,
      offlineQueue: [],
      isLoading: false,
    });
  });

  it("履歴の読み込み中は、話し込んどる会話でも名前シートを出さない", async () => {
    let releaseHistory: (rows: (typeof USER_MESSAGE)[]) => void = () => {};
    vi.mocked(api.listConversationMessages).mockReturnValue(
      new Promise((resolve) => {
        releaseHistory = resolve;
      }),
    );

    const { rerender } = renderOuApp({ page: "home" });

    fireEvent.click(await screen.findByRole("button", { name: "テストとの会話を開く" }));
    await waitFor(() => expect(window.location.pathname).toBe("/chat/char-1"));

    // App は URL を見て route を作り直す。履歴はまだ宙に浮いたまま talk 画面が出る。
    rerender(<OuApp route={{ page: "chat", characterId: "char-1", conversationId: "conv-1" }} />);

    await screen.findByText("おかえりなさい");
    await waitFor(() => expect(vi.mocked(api.fetchCurrentUser)).toHaveBeenCalled());
    expect(screen.queryByText("呼び方を、教えて")).toBeNull();

    releaseHistory([USER_MESSAGE]);

    await waitFor(() => expect(screen.getByText("ただいま")).toBeInTheDocument());
    expect(screen.queryByText("呼び方を、教えて")).toBeNull();
  });
});

// 名前を尋ねる導線は、キャラの挨拶だけが出ている「会話開始直後」に一度だけ自然に出る。
// 設定画面の奥に隠れた入力欄まで行かせず、その場でスキップも決定もできる。
describe("OuApp 名前を尋ねる導線", () => {
  const GREETING_CHARACTER = { ...CHARACTER, greeting: "おかえりなさい" };
  const GREETING_CONVERSATION = { ...CONVERSATION, characterGreeting: "おかえりなさい" };

  beforeEach(() => {
    vi.mocked(api.listCharacters).mockResolvedValue([GREETING_CHARACTER]);
    vi.mocked(api.listConversations).mockResolvedValue([GREETING_CONVERSATION]);
    // メッセージ0件=まだ何も交わしていない、会話が始まった直後の状態
    vi.mocked(api.listConversationMessages).mockResolvedValue([]);
    stubMatchMedia();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.removeItem("ou_name_prompt_asked");
    useChatStore.setState({
      messages: [],
      currentConversationId: null,
      activeCharacterId: null,
      offlineQueue: [],
      isLoading: false,
    });
  });

  it("呼び方が何も分かっていなければ、挨拶だけの会話開始時に自然に出る", async () => {
    vi.mocked(api.fetchCurrentUser).mockResolvedValue({
      email: "x@example.com",
      logoutUrl: null,
      isLocal: true,
      displayName: null,
    });

    renderOuApp();

    await screen.findByText("おかえりなさい");
    expect(await screen.findByText("呼び方を、教えて")).toBeInTheDocument();
  });

  it("あとで決める、を押すと閉じて既読フラグが残る", async () => {
    vi.mocked(api.fetchCurrentUser).mockResolvedValue({
      email: "x@example.com",
      logoutUrl: null,
      isLocal: true,
      displayName: null,
    });

    renderOuApp();

    await screen.findByText("呼び方を、教えて");
    fireEvent.click(screen.getByRole("button", { name: "あとで決める" }));

    await waitFor(() => {
      expect(screen.queryByText("呼び方を、教えて")).not.toBeInTheDocument();
    });
    expect(localStorage.getItem("ou_name_prompt_asked")).toBe("1");
  });

  it("既にアカウントの名前が分かっていれば出さない", async () => {
    vi.mocked(api.fetchCurrentUser).mockResolvedValue({
      email: "x@example.com",
      logoutUrl: null,
      isLocal: true,
      displayName: "コウスケ",
    });

    renderOuApp();

    await screen.findByText("おかえりなさい");
    await waitFor(() => {
      expect(vi.mocked(api.fetchCurrentUser)).toHaveBeenCalled();
    });
    expect(screen.queryByText("呼び方を、教えて")).not.toBeInTheDocument();
  });

  it("既に一度尋ねている（既読フラグ済み）なら出さない", async () => {
    localStorage.setItem("ou_name_prompt_asked", "1");
    vi.mocked(api.fetchCurrentUser).mockResolvedValue({
      email: "x@example.com",
      logoutUrl: null,
      isLocal: true,
      displayName: null,
    });

    renderOuApp();

    await screen.findByText("おかえりなさい");
    await waitFor(() => {
      expect(vi.mocked(api.fetchCurrentUser)).toHaveBeenCalled();
    });
    expect(screen.queryByText("呼び方を、教えて")).not.toBeInTheDocument();
  });
});

// D15: ?m=<id> の直リンクで開いた画面が、会話中(ストリーミング等)に messages が
// 更新されるたびに同じ対象へ scrollIntoView({block:"center"}) を再実行し、
// 読んでいる最中に勝手に上へ戻っていた。対象は一度きり合わせれば十分で、
// focusMessageId が変わらない限り再発火してはいけない。
describe("OuApp 直リンクの自動スクロールが会話更新のたびに再発火しない (D15)", () => {
  let scrollIntoView: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.mocked(api.listCharacters).mockResolvedValue([CHARACTER]);
    vi.mocked(api.listConversations).mockResolvedValue([CONVERSATION]);
    vi.mocked(api.listConversationMessages).mockResolvedValue([ASSISTANT_MESSAGE]);
    stubMatchMedia();
    // jsdom は scrollIntoView を実装しないため stub する。呼び出し回数の検証にも使う。
    scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView as unknown as Element["scrollIntoView"];
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useChatStore.setState({
      messages: [],
      currentConversationId: null,
      activeCharacterId: null,
      offlineQueue: [],
      isLoading: false,
    });
  });

  it("同じ?m=のまま会話が進んでも、上へ戻るスクロールは最初の1回だけ", async () => {
    renderOuApp({
      page: "chat",
      characterId: "char-1",
      conversationId: "conv-1",
      focusMessageId: ASSISTANT_MESSAGE.id,
    });

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));

    // ストリーミング中の新着チャンクは messages を更新し続ける。focusMessageId が
    // 張りっぱなしのままだと、同じ対象へ毎回 scrollIntoView が走り、読んでいる最中に
    // 画面が上(古い発言)へ戻される。
    act(() => {
      useChatStore.getState().addMessage({
        id: "msg-new-1",
        role: "user",
        content: "続き",
        createdAt: 10,
      });
    });
    act(() => {
      useChatStore.getState().addMessage({
        id: "msg-new-2",
        role: "assistant",
        content: "<response><dialogue>「つづき」</dialogue></response>",
        createdAt: 11,
      });
    });

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });
});

// D14: 返信が長いと、生成中に届く新着チャンクのたびに messages が更新され、その effect が
// 無条件で el.scrollTop = el.scrollHeight を実行して最下部へ引き戻す。スマホでは、指が
// まだ画面に触れている(スクロールジェスチャー中)の瞬間にこれをやると、ネイティブの
// タッチスクロールを割り込みで潰してしまい、「スクロールできなくなった」ように見える。
describe("OuApp 長い返信のストリーミング中はタッチ操作中の自動スクロールを止める (D14)", () => {
  beforeEach(() => {
    vi.mocked(api.listCharacters).mockResolvedValue([CHARACTER]);
    vi.mocked(api.listConversations).mockResolvedValue([CONVERSATION]);
    vi.mocked(api.listConversationMessages).mockResolvedValue([ASSISTANT_MESSAGE]);
    stubMatchMedia();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useChatStore.setState({
      messages: [],
      currentConversationId: null,
      activeCharacterId: null,
      offlineQueue: [],
      isLoading: false,
    });
  });

  it("指が触れている間に届いた新着チャンクは scrollTop を最下部へ戻さない", async () => {
    renderOuApp();

    const list = await screen.findByRole("log", { name: "会話" });

    // jsdom はレイアウトを計算しないため、スクロール位置を明示的に差し替えて検証する。
    Object.defineProperty(list, "scrollHeight", { value: 2000, configurable: true });
    Object.defineProperty(list, "clientHeight", { value: 500, configurable: true });
    let scrollTopValue = 1500; // 最下部(2000-1500-500=0)から読み始めた状態
    Object.defineProperty(list, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (v: number) => {
        scrollTopValue = v;
      },
    });

    // 指を置く(読もうとしてスクロールジェスチャーを始める瞬間)
    fireEvent.touchStart(list);

    // タッチ中に長い返信のチャンクが届く
    act(() => {
      useChatStore
        .getState()
        .updateMessage(
          ASSISTANT_MESSAGE.id,
          "<response><dialogue>「つづきの本文」</dialogue></response>",
          true,
        );
    });

    // 指を離すまでは、強制的な最下部への巻き戻しが起きない
    expect(scrollTopValue).toBe(1500);

    // 指を離すと、タッチ中に見送っていた分をここで拾って最下部へ追いつく
    // (見送ったまま次のチャンクが来ないと、読み終わっていないのに置いてけぼりになる)
    fireEvent.touchEnd(list);
    expect(scrollTopValue).toBe(2000);
  });
});

// apiFetch は 429 でこのイベントを投げとるのに、購読しとる場所が本番に 1 つも無かった
// （購読しとったのはテストだけ）。利用制限に当たっても画面には何も出ず、
// 押しても反応せんだけの状態になる。
describe("利用制限に当たったことを知らせる", () => {
  beforeEach(() => {
    stubMatchMedia();
    vi.mocked(api.listCharacters).mockResolvedValue([]);
    vi.mocked(api.listConversationMessages).mockResolvedValue([]);
    vi.mocked(api.fetchCurrentUser).mockResolvedValue({ email: "x@example.com" } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("quota-exceeded を受けたら知らせる", async () => {
    const errorToast = vi.spyOn(toast, "error").mockImplementation(() => "" as never);
    renderOuApp();

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(QUOTA_EXCEEDED_EVENT, { detail: { error: "今日はここまで" } }),
      );
    });

    expect(errorToast).toHaveBeenCalledWith("今日はここまで");
  });

  it("理由が無くても黙らん", async () => {
    const errorToast = vi.spyOn(toast, "error").mockImplementation(() => "" as never);
    renderOuApp();

    await act(async () => {
      window.dispatchEvent(new CustomEvent(QUOTA_EXCEEDED_EVENT, { detail: {} }));
    });

    expect(errorToast).toHaveBeenCalledTimes(1);
  });
});
