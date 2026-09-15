import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// 2026-07-26: setupFreshConversation の直後に status:"completed" を書いとったため、
// 途中経過のファイルが最初から完了を名乗っとった。25ターン定義のシナリオが
// 3ターンで「completed」と記録され、落ちた run を完走と読み違えた。
describe("シナリオの初期状態", () => {
  it("会話を作った時点では completed を書かん", () => {
    const source = readFileSync(path.resolve(__dirname, "scenario-runner.ts"), "utf8");
    const setupBlock = source.slice(
      source.indexOf("conversationId: setup.conversationId,"),
      source.indexOf("conversationId: setup.conversationId,") + 400,
    );
    expect(setupBlock).not.toContain('status: "completed"');
    expect(setupBlock).toContain('status: "running"');
  });
});
