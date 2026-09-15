import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { ImgHTMLAttributes, ReactNode } from "react";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Character } from "@/lib/api";
import type { ChatMessage } from "@/store/chat-store";

import { ChipsPanel } from "./chips-panel";
import { HerMessage } from "./her-message";
import { InputBar } from "./input-bar";
import { OU2 } from "./ouse-tokens";
import { TalkHeader } from "./talk-header";

vi.mock("@/component/ui/authenticated-image", () => ({
  AuthenticatedImage: (props: ImgHTMLAttributes<HTMLImageElement> & { fallback?: ReactNode }) => {
    const { fallback, ...imageProps } = props;
    void fallback;
    return <img {...imageProps} />;
  },
}));

const character: Character = {
  id: "character-1",
  userId: "user-1",
  name: "詩乃",
  avatar: "/shino.png",
  systemPrompt: "",
  greeting: "",
  tags: [],
  createdAt: 0,
};

describe("案A「燈」チャットデザイン", () => {
  afterEach(cleanup);

  it("ヘッダーと各メッセージに原本サイズのアバターを表示する", () => {
    const header = render(
      <TalkHeader
        character={character}
        onMenuOpen={vi.fn()}
        onBackToHome={vi.fn()}
        sceneLabel="雨夜のひと部屋"
      />,
    );
    const headerAvatar = header.container.querySelector('img[src="/shino.png"]')?.parentElement;

    expect(headerAvatar).toHaveClass("h-9", "w-9");
    expect(headerAvatar).toHaveStyle({ border: `1px solid ${OU2.avatarRing}` });
    // 関係性・プレイ回数のサブタイトルは実データが無いので出さない（issue #920）
    expect(screen.queryByText(/回プレイ/)).toBeNull();

    cleanup();
    const message: ChatMessage = {
      id: "message-1",
      role: "assistant",
      content: "<response><dialogue>「おかえり」</dialogue></response>",
    };
    const body = render(<HerMessage message={message} isStreaming={false} character={character} />);
    const messageAvatar = body.container.querySelector('img[src="/shino.png"]')?.parentElement;

    expect(messageAvatar).toHaveClass("h-[38px]", "w-[38px]");
    expect(messageAvatar).toHaveStyle({ border: `1px solid ${OU2.avatarRingMsg}` });
  });

  it("台詞・心の声・ナレーション・記憶チップを原本値で描画する", () => {
    const message: ChatMessage = {
      id: "message-2",
      role: "assistant",
      content:
        "<response><dialogue>「待ってた」</dialogue><inner>この距離が近い。</inner><narration>彼女が隣に座る。</narration><remember>雨が好き</remember></response>",
    };
    render(<HerMessage message={message} isStreaming={false} character={character} />);

    expect(screen.getByText("「待ってた」").closest("div")).toHaveStyle({
      color: OU2.text,
      fontSize: "18px",
      lineHeight: "1.85",
    });
    expect(screen.getByText("彼女が隣に座る。").closest("div")).toHaveStyle({
      color: OU2.narration,
      fontSize: "15px",
      lineHeight: "2.05",
    });
    expect(screen.getByText("覚えておく：雨が好き")).toHaveStyle({
      color: OU2.rememberText,
      border: `1px dashed ${OU2.rememberBorder}`,
      fontSize: "11.5px",
    });
  });

  // 続き / 行動 / 本音 / 急展開 / 覚えて / セリフを渡す のチップは 2026-08-17 に局長判断で
  // YAGNI 撤去した。原本の「通常色チップ」の主張はそれと一緒に消える。強調色（長さの傾き）は
  // 残っとるので、そちらだけ当てる。
  it("長さの傾きは原本の強調色を使う", () => {
    render(
      <ChipsPanel
        sayDoMode={null}
        onSayDoChange={vi.fn()}
        responseLength="very_long"
        onLengthChange={vi.fn()}
        onSuggestToggle={vi.fn()}
        suggestOpen={false}
        canSuggest
        disabled
      />,
    );

    expect(screen.getByRole("button", { name: "ことば たっぷり" })).toHaveStyle({
      border: `1px solid ${OU2.chipGoldBorderStrong}`,
      background: OU2.chipGoldBgStrong,
      color: OU2.chipTextStrong,
      fontWeight: 700,
    });
  });

  it("画像フレームと入力バーを原本値で描画する", () => {
    const message: ChatMessage = {
      id: "message-3",
      role: "assistant",
      content: "<response><dialogue>「見て」</dialogue></response>",
      imageUrl: "/generated.png",
    };
    const imageMessage = render(
      <HerMessage message={message} isStreaming={false} character={character} />,
    );
    const image = imageMessage.container.querySelector('img[src="/generated.png"]');

    expect(image).toHaveClass("h-[240px]");
    expect(image).toHaveAccessibleName("詩乃からの写真");
    expect(image?.parentElement).toHaveStyle({
      borderRadius: "18px",
      border: `1px solid ${OU2.imageFrameBorder}`,
      boxShadow: "0 14px 34px -18px rgba(0,0,0,.7)",
    });

    cleanup();
    render(
      <InputBar
        value=""
        onChange={vi.fn()}
        onSend={vi.fn()}
        onImageGenerate={vi.fn()}
        isLoading={false}
        characterName="詩乃"
      />,
    );
    const input = screen.getByRole("textbox", { name: "詩乃へのメッセージ入力" });

    expect(input).toHaveClass("text-[14px]", "font-sans-ui");
    expect(input).toHaveStyle({ "--input-placeholder": OU2.inputPlaceholder });
    expect(input.parentElement).toHaveStyle({
      padding: "10px 18px 10px 16px",
      background: OU2.inputBarBg,
      border: `1px solid ${OU2.inputBarBorder}`,
    });
    expect(input.parentElement?.parentElement).toHaveStyle({
      background: OU2.barBg,
      borderTop: `1px solid ${OU2.inputBarTopBorder}`,
    });
  });

  it("原本の色値をトークンで固定する", () => {
    expect(OU2.innerMono).toBe("#8c8270");
    expect(OU2.narration).toBe("#b3a791");
    expect(OU2.rememberText).toBe("#bda87f");
    expect(OU2.inputPlaceholder).toBe("#8e8470");
    expect(OU2.sendInk).toBe("#241a0e");
  });

  it("talk画面は全高を使い、内側コンポーネントの原本余白を重ねない", () => {
    const css = readFileSync(resolve(process.cwd(), "src/component/ouse/ouse.css"), "utf8");
    const talkRule = css.match(/\.ou-col\.is-talk\s*{(?<body>[^}]*)}/)?.groups?.["body"];

    expect(talkRule).toMatch(/max-height:\s*none/);
    expect(talkRule).toMatch(/padding:\s*84px 0 0/);
  });

  // レールは 639px 以下で display:none になるのに、.ou-col.is-talk(0,2,0) の left:76px が
  // モバイルの .ou-col(0,1,0) リセットに勝ってしまい、本文が右へ 76px ずれとった。
  // メディアクエリは詳細度を上げんので、is-talk 自身を上書きせなあかん。
  it("スマホではトーク画面をレール幅ぶんずらさない", () => {
    const css = readFileSync(resolve(process.cwd(), "src/component/ouse/ouse.css"), "utf8");
    const mobileBlock = css.match(/@media \(max-width: 639px\)\s*{(?<body>[\S\s]*?)\n}/)?.groups?.[
      "body"
    ];

    expect(mobileBlock).toBeDefined();
    expect(mobileBlock).toMatch(/\.ou-col\.is-talk\s*{[^}]*left:\s*0/);
  });

  it("動きを減らす設定では燈画面の点滅と遷移を止める", () => {
    const css = readFileSync(resolve(process.cwd(), "src/component/ouse/ouse.css"), "utf8");
    const reducedMotionRule = css.match(
      /@media \(prefers-reduced-motion: reduce\)\s*{(?<body>[\S\s]*?)\n}/,
    )?.groups?.["body"];

    expect(reducedMotionRule).toMatch(/animation-duration:\s*0\.01ms !important/);
    expect(reducedMotionRule).toMatch(/animation-iteration-count:\s*1 !important/);
    expect(reducedMotionRule).toMatch(/transition-duration:\s*0\.01ms !important/);
  });
});
