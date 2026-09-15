import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// 同じ本文を描くコードが 3 つある。実測(2026-08-16 vlong-dogfood)でモデルは
// action と dialogue を交互に何組も返す（1 応答に 10 組）ので、節ごとにまとめて描くと
// 「地の文まとめ→台詞まとめ」に組み替わり、書かれた場面の時系列が画面上で壊れる。
//
// her-message と message-bubble は各自のテストで出現順が固定されとる。group-view は
// react-query と api を丸ごと持っとって単体で描画でけへんので、ここは
// no-injected-consent-framing.test.ts と同じくソースを読んで固定する。
// 3 つ目だけ直し漏れる、が実際に起きた形なので、3 つまとめて見る。

const RENDERERS = [
  "src/component/ouse/her-message.tsx",
  "src/component/chat/message-bubble.tsx",
  "src/component/group/group-view.tsx",
] as const;

const readSource = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("本文を描く経路は全部 blocks の出現順を使う", () => {
  it.each(RENDERERS)("%s が blocks を読んどる", (path) => {
    expect(readSource(path)).toContain(".blocks");
  });

  // 節ごとにまとめた値を、順序を持つ本文としてそのまま描かんこと。
  // 直前に blocks を見とるかどうかまではソースでは分からんので、
  // 「blocks を読んどる」と対にして、両方揃っとることを条件にする。
  it.each(RENDERERS)("%s が blocks を無視した描画へ戻っとらん", (path) => {
    const source = readSource(path);
    const usesOrderedBlocks = /\.blocks/.test(source);
    const rendersMergedPair =
      /{\s*parsed\.action\s*}/.test(source) && /{\s*parsed\.dialogue\s*}/.test(source);
    expect(usesOrderedBlocks && !rendersMergedPair).toBe(true);
  });
});
