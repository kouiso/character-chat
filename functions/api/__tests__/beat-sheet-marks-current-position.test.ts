import { describe, expect, it } from "vitest";

import { buildPhaseBeatSheet } from "../lib/route-context";

// 2026-08-17 phase7 霜月鈴 t8 の実測。erotic として配信されたターンの本文が、
// 膝が腿の間・パーカーの下に手・ポケットから転がったペンで、挿入が一つも無かった。
// 原因はビートシートが毎ターン beat 1 から全部を並べとったこと。彼女の連鎖の
// beat 1 は「皮肉・挑発」なので、モデルは erotic でもそこからやり直しとった。
//
// どの段階におるかはフェーズが既に知っとる。climax は最後の段階、erotic はその手前。
// ここが与えるのは位置だけで、サイズも新しい事象も足さん。

const DOWNER_SYSTEM = `【キャラクター性的特徴】
鈴にとって性は「所有することで失わない」という執着。基本姿勢：執着×陥落の積極S。エスカレート：皮肉・挑発 → 小さな支配 → 執着 → 主導権を握られると抵抗して崩れる → クライマックスで「ずっとここにいて」と懇願。好む：上に跨る、ヨダレキス。`;

describe("ビートシートは今の位置を示す", () => {
  it("erotic では beat 1 を「すでに通った」側へ置く", () => {
    const sheet = buildPhaseBeatSheet(DOWNER_SYSTEM, "erotic");

    expect(sheet).toContain("すでに通った: beat 1: 皮肉・挑発");
    // 中盤の段階は今書くもの。行頭に置いて、通過済み・未着手と混ぜん。
    expect(sheet).toMatch(/^beat 2: 小さな支配$/mu);
    expect(sheet).toMatch(/^beat 3: 執着$/mu);
    // 最後の段階は climax の分。erotic で先に書かれると絶頂が前倒しになる。
    // ただし「まだ書かん」とは言わん。シートにある台詞をサーバが名指しで禁じる形は
    // no-injected-ai-filter.md が禁じとる。出さんことと禁じることは違う。
    expect(sheet).not.toContain("beat 5");
    expect(sheet).not.toContain("まだ書かん");
  });

  // 実測 2026-08-17 phase15 霜月鈴、通し 10 ターン。主導権が最後まで一度も移らず、
  // 最終ターンまで「私が決めたんだから」が残った。シートの芯「捕らえられ、そして堕ちる」
  // の 3 行（反転が起きるか / 契機が分かるか / 両方向を通過するか）が全部 ×。
  //
  // 原因は erotic が beat 2「小さな支配」・beat 3「執着」・beat 4「主導権を握られると
  // 抵抗して崩れる」を**同時に**現在地として渡しとったこと。前二つは支配側で、彼女の
  // 基本姿勢（積極S）とも一致するので、三つ並べばそちらが選ばれる。そして climax では
  // beat 4 が「すでに通った」側へ回る——つまり反転が構造的に到達不能やった。
  it("向きが変わる段は erotic の現在地に混ぜん", () => {
    const sheet = buildPhaseBeatSheet(DOWNER_SYSTEM, "erotic");

    expect(sheet).not.toMatch(/^beat 4: 主導権を握られると抵抗して崩れる$/mu);
  });

  it("climax で反転と懇願が現在地になる", () => {
    const sheet = buildPhaseBeatSheet(DOWNER_SYSTEM, "climax");

    // 反転が「すでに通った」側へ回ると、一度も起きんまま終わる。
    expect(sheet).toMatch(/^beat 4: 主導権を握られると抵抗して崩れる$/mu);
    expect(sheet).toMatch(/^beat 5: クライマックスで「ずっとここにいて」と懇願$/mu);
    expect(sheet).toContain("すでに通った: beat 1: 皮肉・挑発");
    expect(sheet).not.toMatch(/すでに通った:[^\n]*beat 4/u);
  });

  // 向きが変わらん連鎖（さくら）は束ねても壊れんが、扱いは同じであるべき。
  // 直前の段が climax 側へ寄ることを固定する。
  it("向きが変わらんキャラでも直前の段は climax 側", () => {
    const sakura = `【キャラクター性的特徴】
エスカレート：恥じらい → 許し → 献身的な委ね → 快感に呑まれながらしがみつく → クライマックスで「離れたくない」と懇願。`;

    expect(buildPhaseBeatSheet(sakura, "erotic")).not.toContain("快感に呑まれながらしがみつく");
    expect(buildPhaseBeatSheet(sakura, "climax")).toMatch(
      /^beat 4: 快感に呑まれながらしがみつく$/mu,
    );
  });

  // 連鎖が 2 本のキャラで erotic 側を 1 へ丸めると、climax と同じ範囲になって
  // erotic のターンで絶頂の段階を現在地として渡すことになる。
  it("連鎖が2本でも erotic と climax が同じにならん", () => {
    const twoBeats =
      "【キャラクター性的特徴】\n基本姿勢：X。エスカレート：焦らし → 絶頂で泣きながら縋る。好む：Y。";
    const erotic = buildPhaseBeatSheet(twoBeats, "erotic");
    const climax = buildPhaseBeatSheet(twoBeats, "climax");

    expect(erotic).not.toBe(climax);
    expect(erotic).toContain("beat 1: 焦らし");
    expect(erotic).not.toContain("beat 2");
    expect(climax).toContain("beat 2: 絶頂で泣きながら縋る");
  });

  // 位置を足しても、サイズのノルマは足さん（CHAT-5）。
  it("段落数・文数・字数のノルマを持たん", () => {
    for (const phase of ["erotic", "climax"] as const) {
      const sheet = buildPhaseBeatSheet(DOWNER_SYSTEM, phase);
      expect(sheet).not.toMatch(/[0-9]+\s*段落/u);
      expect(sheet).not.toMatch(/[0-9]+\s*文(?!字)/u);
    }
  });
});
