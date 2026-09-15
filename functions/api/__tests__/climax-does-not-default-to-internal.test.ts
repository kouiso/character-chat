import { describe, expect, it } from "vitest";

import { EXEMPLAR_CLIMAX, SCENE_CONTEXT_MESSAGES } from "../lib/route-context";

// 局長報告 2026-08-17「なか出しの指定をしてないのに、勝手になか出しに進む」。
//
// climax の指示は 3 つの部品で中出しに触れとって、2 つは条件付きの書き方やった——
// 「When the user ejaculates inside」「[体内描写 — 膣内射精の場合]」。
// 無条件やったのは **見本** で、EXEMPLAR_CLIMAX は丸ごと中出しの場面。
// 文体も内容も指示より見本が勝つので、climax に入った時点で必ず中出しになっとった。
//
// 見本は「密度の見本」として要る（局長の「爪痕を残す」軸は削らん）。要らんのは
// 「どこで終えるか」まで見本が決めてしまうこと。そこは場面が決める。

describe("climax が中出しを既定にせん", () => {
  it("見本が「どこで終えるか」は真似させんと言う", () => {
    expect(EXEMPLAR_CLIMAX).toMatch(/Do NOT copy WHERE he finishes/u);
    // 場面が決めることと、決まっとらん時に勝手に足さんことの両方を言う。
    expect(EXEMPLAR_CLIMAX).toMatch(/do not invent it/u);
  });

  it("見本自体は残っとる（密度の見本として要る）", () => {
    expect(EXEMPLAR_CLIMAX).toContain("[Good example");
    expect(SCENE_CONTEXT_MESSAGES.climax).toContain(EXEMPLAR_CLIMAX);
  });

  it("射精の段階描写が、場面で確立された時だけに掛かる", () => {
    expect(SCENE_CONTEXT_MESSAGES.climax).toMatch(/Only when the scene has established/u);
    expect(SCENE_CONTEXT_MESSAGES.climax).toMatch(/do not introduce it yourself/u);
  });

  // さくらの芯「痕を残す・不可逆」は中出しの描写そのもの。条件付きにするのと
  // 削るのは違う。体内描写の部品は残っとらなあかん
  // （no-injected-consent-framing.test.ts も必須文字列として持っとる）。
  it("体内描写の部品を削っとらん", () => {
    expect(SCENE_CONTEXT_MESSAGES.climax).toContain("[体内描写 — 膣内射精の場合]");
    expect(SCENE_CONTEXT_MESSAGES.climax).toContain("子宮に届く熱さ");
  });

  it("孕ませの反応も条件付きのまま", () => {
    expect(SCENE_CONTEXT_MESSAGES.climax).toMatch(/When the user mentions 孕ませ/u);
  });
});
