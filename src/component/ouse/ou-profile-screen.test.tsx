import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Character } from "@/lib/api";
import { buildNaturalCharacterProfileText, parseSystemPrompt } from "@/lib/prompt-builder";

import { OuProfileScreen } from "./ou-profile-screen";

const character = {
  id: "import-charap-test",
  userId: "user-1",
  name: "アイリス",
  avatar: null,
  slug: null,
  systemPrompt: "",
  greeting: "はじめまして",
  tags: ["imported", "charap", "adult"],
  createdAt: 1,
} as unknown as Character;

// プロフィールは「この子との会話を消す」導線のために会話一覧を読むので、
// 表示だけを見るこのテストでも QueryClientProvider が要る。
const renderProfile = (overrides: Partial<Character> = {}) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OuProfileScreen
        character={{ ...character, ...overrides }}
        open
        onOpenChange={vi.fn()}
        onStartTalk={vi.fn()}
      />
    </QueryClientProvider>,
  );
};

describe("OuProfileScreen の気配タグ", () => {
  afterEach(cleanup);

  it("内部タグ imported / charap を気配タグとして出さない", () => {
    renderProfile();

    expect(screen.getByText("adult")).toBeInTheDocument();
    expect(screen.queryByText("imported")).toBeNull();
    expect(screen.queryByText("charap")).toBeNull();
  });

  it("内部タグしか無いキャラではタグ行ごと出さない", () => {
    renderProfile({ tags: ["imported", "charap"] });

    expect(screen.queryByText("imported")).toBeNull();
    expect(screen.queryByText("charap")).toBeNull();
  });
});

describe("charap/saylo インポートのプロフィール文表示", () => {
  it("【設定】を personality、【口調・振る舞い】1行目を speechStyle として表示する", () => {
    const systemPrompt = `【キャラクター】
名前: アイリス
年齢: 18歳成人

【設定】
あなたが率いる戦闘型アンドロイド部隊の隊員。冷静沈着で常に仲間のことを気にかけている。

【口調・振る舞い】
- 一人称「私」、呼び方「指揮官」
- 冷静で忠実。短く報告し、慕情は抑えて滲ませる`;

    const parsed = parseSystemPrompt(systemPrompt);
    expect(parsed.personality).toContain("冷静沈着");
    expect(parsed.personality).not.toContain("指揮官");
    expect(parsed.speechStyle).toContain("指揮官");

    const profileText = buildNaturalCharacterProfileText(parsed.personality);
    expect(profileText).toContain("冷静沈着");
    expect(profileText).not.toContain("【設定】");
    expect(profileText).not.toContain("年齢");
  });
});
