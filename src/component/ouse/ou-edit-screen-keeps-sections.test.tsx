import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OuEditScreen } from "./ou-edit-screen";

// 編集画面はシートを組み直して保存する。組み直しの引数から【キャラカード】と【関係性】が
// 抜けとったので、**一度保存するだけで両方の節が消えとった**。キャラカードには arc_* /
// sensory_focus / forbidden_words が入っとるので、消えると本文の質がそのまま落ちる。
const SYSTEM_PROMPT = [
  "【キャラクター】",
  "名前: 霜月 鈴",
  "だるげな年上。皮肉で距離を取る。",
  "",
  "【関係性】",
  "雨の夜に拾われた相手。まだ名前も知らん。",
  "",
  "【シナリオ】",
  "彼女の部屋。雨音が続いとる。",
  "",
  "【キャラカード】",
  "arc_erotic: 動きを決めとるのは自分",
  "forbidden_words: きゃー、うれしい♡",
  "sensory_focus: 雨音、体温、煙草の匂い",
].join("\n");

const CHARACTER = {
  id: "char-downer",
  userId: "user-1",
  name: "霜月 鈴",
  avatar: null,
  systemPrompt: SYSTEM_PROMPT,
  greeting: "",
  tags: [],
  createdAt: 0,
};

describe("OuEditScreen の保存", () => {
  afterEach(cleanup);

  it("編集してへん【キャラカード】と【関係性】を消さん", () => {
    const onSave = vi.fn();
    render(
      <OuEditScreen character={CHARACTER} onSave={onSave} onDelete={vi.fn()} onBack={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0] as { systemPrompt: string };
    expect(saved.systemPrompt).toContain("arc_erotic: 動きを決めとるのは自分");
    expect(saved.systemPrompt).toContain("forbidden_words: きゃー、うれしい♡");
    expect(saved.systemPrompt).toContain("雨の夜に拾われた相手");
  });
});
