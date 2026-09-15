import { describe, expect, it } from "vitest";

import { detectScenePhase } from "../scene-phase";

// 実測 2026-08-18 phase17 / phase19 / phase21（.work/e2e-results/vlong-dogfood/）:
// 霜月鈴の通しで t9「……出る。全部きみの中に。」が 3 ラン続けて intimate のまま配信され、
// 返ってきたのは初対面の前戯やった（場面が 3 段遅れる）。
//
// hasSplitCreampieDeclaration は 2026-08-16 に同じ観測から入れられとったが、
// contextRank >= erotic で門を掛けとった。霜月鈴の通しは erotic へ一度も届かんので、
// 「intimate で詰まる」を直す共起が「intimate で詰まってへんこと」を条件にしとって
// 永久に開かんかった。人称つきの行き先まで書いた形だけ intimate から読む。
const msgs = (...contents: string[]) =>
  contents.map((content) => ({ role: "user" as const, content }));

const REACH_INTIMATE = "……近いね。少しだけ、手に触れてもいい？";

describe("人称つきの行き先まで書いた射精宣言を intimate から climax として読む", () => {
  it("「……出る。全部きみの中に。」が climax になる", () => {
    expect(detectScenePhase(msgs(REACH_INTIMATE, "……出る。全部きみの中に。"))).toBe("climax");
  });

  it("語順が逆でも読む", () => {
    expect(detectScenePhase(msgs(REACH_INTIMATE, "きみの中に、このまま出す"))).toBe("climax");
  });

  // 文脈ゲートは付けん。霜月鈴の通しは LLM 分類器だけで intimate へ上がっとって、
  // キーワード上の走行フェーズは 10 ターン全部 conversation のままやった（実測）。
  // 文脈を条件にすると、この規則が要る場面でだけ永久に開かん。
  it("会話段からでも読む（キーワードの床が上がらん場面が実在するため）", () => {
    expect(detectScenePhase(msgs("……出る。全部きみの中に。"))).toBe("climax");
  });

  it("人称のない「中に」は拾わん（置き場所の誤検出を防ぐ）", () => {
    expect(detectScenePhase(msgs(REACH_INTIMATE, "もう出るね。中にカギ置いてあるから"))).not.toBe(
      "climax",
    );
  });

  it("場所を出る言い回しを拾わん", () => {
    expect(detectScenePhase(msgs(REACH_INTIMATE, "部屋の中に荷物置いて、先に外に出るわ"))).not.toBe(
      "climax",
    );
  });
});
