import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// issue #1495: checkRepetition は配信経路の WARN でしかなく、実測で反復を 1 件も
// 名指しでけへんかった（phase62〜66 の 100 ターンで「違反あり」87 件のうち 82 件が
// XML のタグ名。phase66 の通読が反復で落とした 16 ターンに対して TP=0 / FN=16）。
// worker のログは実測の切り分けに使う道具なので、当たらん警告が毎ターン出ると
// 次に原因を追う人が同じ罠を踏む。戻されたら落とす。
const routeContextSource = readFileSync(path.resolve(__dirname, "../lib/route-context.ts"), "utf8");

describe("#1495 配信経路に語彙反復の WARN を戻さん", () => {
  it("route-context が checkRepetition を呼ばん", () => {
    expect(routeContextSource).not.toContain("checkRepetition");
  });

  it("route-context が vocab_repetition を出力せん", () => {
    expect(routeContextSource).not.toContain("vocab_repetition");
  });
});
