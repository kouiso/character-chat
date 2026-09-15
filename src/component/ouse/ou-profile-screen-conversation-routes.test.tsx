import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type * as ApiModule from "@/lib/api";
import type { Character, ConversationSummary } from "@/lib/api";

import { OuProfileScreen } from "./ou-profile-screen";

const deleteConversation = vi.fn(async (conversationId: string) => {
  void conversationId;
});

const conversationFixture = (
  id: string,
  characterId: string,
  characterName: string,
): ConversationSummary => ({
  id,
  title: "雨の夜",
  createdAt: 1,
  updatedAt: 2,
  characterId,
  characterName,
  characterGreeting: "おかえりなさい。",
  characterSystemPrompt: "",
  characterAvatar: null,
  lastAssistantMessage: "続きを待っていました。",
});

const CONVERSATIONS: ConversationSummary[] = [
  conversationFixture("conv-1", "char-1", "燈子"),
  conversationFixture("conv-2", "char-1", "燈子"),
  conversationFixture("conv-other", "char-2", "すみれ"),
];

const listConversations = vi.fn(async (): Promise<ConversationSummary[]> => CONVERSATIONS);

// use-chat-query が @/lib/api を丸ごと使うので、実物を土台にしてこの画面が触る 2 つだけ差し替える。
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  listConversations: () => listConversations(),
  deleteConversation: (id: string) => deleteConversation(id),
}));

const character = {
  id: "char-1",
  userId: "user-1",
  name: "燈子",
  avatar: null,
  slug: null,
  systemPrompt: "",
  greeting: "おかえりなさい。",
  tags: [],
  createdAt: 1,
} as unknown as Character;

const renderProfile = (
  props: Partial<Parameters<typeof OuProfileScreen>[0]> = {},
): {
  onStartTalk: ReturnType<typeof vi.fn>;
  onStartNewConversation: ReturnType<typeof vi.fn>;
} => {
  const onStartTalk = vi.fn();
  const onStartNewConversation = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <OuProfileScreen
        character={character}
        open
        onOpenChange={vi.fn()}
        onStartTalk={onStartTalk}
        onStartNewConversation={onStartNewConversation}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onStartTalk, onStartNewConversation };
};

afterEach(() => {
  cleanup();
  deleteConversation.mockClear();
  listConversations.mockClear();
});

// #1484: openNewConversation は在ったのに、プロフィールの主 CTA は「続きから開く」だけで、
// 新しく始める道は返事設定シートの中にしか無かった（呼ぶ側が足りん型）。
describe("プロフィールから新しく話し始められる", () => {
  it("「はじめから話す」で新しい会話の口が呼ばれる", async () => {
    const { onStartNewConversation, onStartTalk } = renderProfile();

    fireEvent.click(await screen.findByRole("button", { name: "はじめから話す" }));

    expect(onStartNewConversation).toHaveBeenCalledTimes(1);
    expect(onStartTalk).not.toHaveBeenCalled();
  });

  it("主 CTA「この子と話す →」は続きから開く側のまま", async () => {
    const { onStartNewConversation, onStartTalk } = renderProfile();

    fireEvent.click(await screen.findByRole("button", { name: "この子と話す →" }));

    expect(onStartTalk).toHaveBeenCalledTimes(1);
    expect(onStartNewConversation).not.toHaveBeenCalled();
  });

  it("新しい会話の口を渡してへん呼び出し側では出さん", () => {
    renderProfile({ onStartNewConversation: undefined });

    expect(screen.queryByRole("button", { name: "はじめから話す" })).toBeNull();
  });
});

// #1485: deleteConversation は在ったのに、消す道は履歴画面にしか無かった。
// 確認の作法は ou-log-screen と同じ二段（消す／やめる）に揃える。
describe("プロフィールからこの子との会話を消せる", () => {
  it("削除は二段。一段目では消えん", async () => {
    renderProfile();

    fireEvent.click(await screen.findByRole("button", { name: "燈子との会話を削除" }));

    expect(deleteConversation).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "ぜんぶ消す" })).toBeTruthy();
  });

  it("「やめる」で必ず戻れる", async () => {
    renderProfile();

    fireEvent.click(await screen.findByRole("button", { name: "燈子との会話を削除" }));
    fireEvent.click(screen.getByRole("button", { name: "やめる" }));

    expect(deleteConversation).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "燈子との会話を削除" })).toBeTruthy();
  });

  it("二段目で初めて、この子の会話だけが消える", async () => {
    renderProfile();

    fireEvent.click(await screen.findByRole("button", { name: "燈子との会話を削除" }));
    fireEvent.click(screen.getByRole("button", { name: "ぜんぶ消す" }));

    await waitFor(() => expect(deleteConversation).toHaveBeenCalledTimes(2));
    expect(deleteConversation).toHaveBeenCalledWith("conv-1");
    expect(deleteConversation).toHaveBeenCalledWith("conv-2");
    expect(deleteConversation).not.toHaveBeenCalledWith("conv-other");
  });

  it("消す対象の件数を口に出す（何件消えるか分からんまま押させん）", async () => {
    renderProfile();

    expect(await screen.findByRole("button", { name: "燈子との会話を削除" })).toHaveTextContent(
      "2件",
    );
  });

  it("この子との会話が無ければ削除の口を出さん", async () => {
    listConversations.mockResolvedValueOnce([
      conversationFixture("conv-other", "char-2", "すみれ"),
    ]);
    renderProfile();

    await waitFor(() => expect(listConversations).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "燈子との会話を削除" })).toBeNull(),
    );
  });
});
