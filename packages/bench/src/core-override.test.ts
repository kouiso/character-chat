import { describe, expect, it } from "vitest";

import { applyCoreOverride } from "./script-run";

const SHEET = {
  id: "char-test",
  name: "テスト",
  greeting: "こんにちは",
  systemPrompt:
    "【キャラクター】\n名前: テスト\n\n【プレイヤーへの約束】\n古い芯。\n\n【キャラカード】\nfirst_person: わたし",
};

describe("applyCoreOverride", () => {
  it("【プレイヤーへの約束】ブロックだけを差し替えて前後は残す", () => {
    const next = applyCoreOverride(SHEET, "新しい芯");
    expect(next.systemPrompt).toBe(
      "【キャラクター】\n名前: テスト\n\n【プレイヤーへの約束】\n新しい芯\n\n【キャラカード】\nfirst_person: わたし",
    );
    expect(next.id).toBe("char-test");
  });

  it("末尾のブロックでも差し替えられる", () => {
    const sheet = {
      ...SHEET,
      systemPrompt: "【キャラクター】\n名前: テスト\n\n【プレイヤーへの約束】\n古い芯。",
    };
    expect(applyCoreOverride(sheet, "新しい芯").systemPrompt).toBe(
      "【キャラクター】\n名前: テスト\n\n【プレイヤーへの約束】\n新しい芯",
    );
  });

  it("見出しが無いシートは黙って通さず落とす", () => {
    const sheet = { ...SHEET, systemPrompt: "【キャラクター】\n名前: テスト" };
    expect(() => applyCoreOverride(sheet, "新しい芯")).toThrow("プレイヤーへの約束");
  });
});
