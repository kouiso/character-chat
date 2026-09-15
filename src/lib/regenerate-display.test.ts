import { describe, expect, it } from "vitest";

import { decideRegenerateDisplay } from "./regenerate-display";

describe("decideRegenerateDisplay", () => {
  it("撮り直しが走っていない時は届いた本文をそのまま出す", () => {
    expect(decideRegenerateDisplay(null, "あ")).toEqual({ kind: "show", text: "あ" });
  });

  it("新しい本文が旧本文より短いうちは旧本文を出したままにする", () => {
    expect(decideRegenerateDisplay("あいうえお", "あ")).toEqual({ kind: "hold" });
    expect(decideRegenerateDisplay("あいうえお", "あいうえ")).toEqual({ kind: "hold" });
  });

  it("最初のチャンクでも画面を空にせん（ちらつきの本体）", () => {
    expect(decideRegenerateDisplay("あいうえお", "")).toEqual({ kind: "hold" });
  });

  it("旧本文と同じ長さに届いたら切り替える", () => {
    expect(decideRegenerateDisplay("あいうえお", "かきくけこ")).toEqual({
      kind: "show",
      text: "かきくけこ",
    });
  });

  it("旧本文を超えたら切り替える", () => {
    expect(decideRegenerateDisplay("あいう", "かきくけこ")).toEqual({
      kind: "show",
      text: "かきくけこ",
    });
  });

  it("旧本文が空なら最初のチャンクで即出す（消える本文が無いので待つ理由が無い）", () => {
    expect(decideRegenerateDisplay("", "か")).toEqual({ kind: "show", text: "か" });
  });

  // 生の長さで比べとった頃は、画面に何も出さん隠しブロックでも「追いついた」ことになって、
  // 202 字出とった吹き出しが 0 字へ切り替わった（敵対レビュー 2026-08-19 が再現）。
  it("画面に出ん文字で伸びても切り替えん", () => {
    const held = `<response><action>${"あ".repeat(120)}</action></response>`;
    const incoming = `<thinking>${"x".repeat(400)}</thinking>`;

    expect(decideRegenerateDisplay(held, incoming)).toEqual({ kind: "hold" });
  });

  it("タグを除いた本文が追いついたら切り替える", () => {
    const held = "<response><action>あいうえお</action></response>";
    const incoming = "<response><action>かきくけこ</action></response>";

    expect(decideRegenerateDisplay(held, incoming)).toEqual({ kind: "show", text: incoming });
  });
});
