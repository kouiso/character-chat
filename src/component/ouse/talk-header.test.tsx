import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Character } from "@/lib/api";

import { TalkHeader } from "./talk-header";

const character = {
  id: "char-1",
  userId: "user-1",
  name: "燈子",
  avatar: null,
  slug: null,
  systemPrompt: "",
  greeting: "",
  tags: [],
  createdAt: 1,
} as unknown as Character;

describe("TalkHeader", () => {
  afterEach(cleanup);

  it("裏付けの無い関係性・プレイ回数を表示しない", () => {
    render(<TalkHeader character={character} onMenuOpen={vi.fn()} />);

    expect(screen.getByText("燈子")).toBeInTheDocument();
    expect(screen.queryByText(/恋人/)).toBeNull();
    expect(screen.queryByText(/回プレイ/)).toBeNull();
    expect(screen.queryByText(/128/)).toBeNull();
  });

  it("シーン名はキャラ名に併記する", () => {
    render(<TalkHeader character={character} onMenuOpen={vi.fn()} sceneLabel="夜の書斎" />);

    // 名前は #1490 でルビ用に <ruby>/<span> へ包まれたので、DOM 上は名前とシーン名が
    // 別のテキストノードになる。読み手に見える一行は変わっとらんので、行ごと突き合わせる。
    expect(screen.getByText(/夜の書斎/).textContent?.replace(/\s+/g, " ")).toBe("燈子 — 夜の書斎");
  });
});
