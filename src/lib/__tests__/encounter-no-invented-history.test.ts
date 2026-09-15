import { describe, expect, it } from "vitest";

import { buildEncounterTensionDirective } from "../encounter-tension";

// 実測 2026-08-17 phase12 さくら t1（migration 0065 適用後）。桜並木で声をかけられた
// 直後のターンで、本文はこうやった:
//   「わたし、あなたに声をかけてもらえて…嬉しいです」
//   「これからも…会ってくれますか？」
//   「わたし、あなたとなら、全部、あげたいんです」
// 計画の共通の失敗形1「最初から好意的」そのもの。ナンパの達成感が消える。
//
// 【出会いの空気】は初対面の合図を出しとったが、中身は音・距離・鼓動といった
// **感覚**の指示だけで、二人の間に何が積み上がっとるかには触れとらんかった。
// 態度を決めつけんための設計（正しい）やけど、その結果、シートに無い関係の履歴を
// 作り出すことは何も止めとらんかった。
//
// 足すのは態度やのうて一貫性の制約。どう感じるかはキャラ設定のまま——
// 喜んでも警戒してもええ。禁じるのは「まだ無いものを既にあるものとして書く」こと。
// no-injected-ai-filter の見分け方（その一文を消したらキャラ設定どおりに振る舞えるか）で
// 見ると、消すとシートの【シナリオ】と食い違う本文が出るので、これはフィルタやない。

const strangerScenario = "桜並木で声をかけられた。今日が初対面。";

describe("初対面で関係の履歴を作らせん", () => {
  it("初対面の場面では、積み上がっとらんものを先取りせんよう言う", () => {
    const directive = buildEncounterTensionDirective(strangerScenario, "");

    expect(directive).toContain("積み上がっとらんものを先取りせん");
    expect(directive).toContain("【シナリオ】に書かれた分だけ");
  });

  // 態度は指定せん。喜ぶか警戒するかはシートが決める。
  it("感じ方はキャラ設定に委ねたまま", () => {
    const directive = buildEncounterTensionDirective(strangerScenario, "");

    expect(directive).toContain("どう感じるか自体はキャラ設定に従う");
    expect(directive).not.toContain("警戒");
    expect(directive).not.toContain("よそよそし");
  });

  // 既存関係のキャラには出さん。「10年連れ添った妻」に履歴を作るなと言うたら逆に壊れる。
  //
  // 場面に出会いの語が一つも無いシートを使うと、ESTABLISHED_RELATIONSHIP_KEYWORDS を
  // まるごと消しても緑のままになる（どちらの判定でも false）。#1236 が相手にしとった
  // 混在シート——出会い方と年月の両方が書いてあるやつ——で当てなあかん（敵対レビュー 2026-08-17）。
  it.each([
    ["結婚して10年になる妻との夜。", "妻"],
    ["マッチングアプリで知り合って、結婚して10年になる。", "妻"],
    ["SNSで知り合って10年になる夫婦。", ""],
  ])("既に関係があるキャラには出さん: %s", (scenario, relationship) => {
    const directive = buildEncounterTensionDirective(scenario, relationship);

    expect(directive).not.toContain("積み上がっとらんものを先取りせん");
  });

  // 「呼吸の乱れ」「距離の詰め合い」は身体がもう関わっとる段の手がかり。会話ターンへ
  // 出すと、このファイルが直そうとしとる先取りを別の口から起こす（敵対レビュー 2026-08-17）。
  it("会話のターンでは生物的な駆け引きを求めん", () => {
    const directive = buildEncounterTensionDirective(strangerScenario, "");

    expect(directive).not.toContain("呼吸の乱れ");
    expect(directive).not.toContain("距離の詰め合い");
    expect(directive).toContain("積み上がっとらんものを先取りせん");
  });

  it("身体が関わっとる段では生物的な駆け引きを求める", () => {
    const directive = buildEncounterTensionDirective(strangerScenario, "", {
      includePhysicalExchange: true,
    });

    expect(directive).toContain("呼吸の乱れ");
    expect(directive).toContain("距離の詰め合い");
  });

  // 番号は動的に振る。点を1つ落として「次の4点」のまま残ると、モデルが数えて
  // 存在せん4点目を探す。
  it("点の数と見出しの数が合っとる", () => {
    const conversation = buildEncounterTensionDirective(strangerScenario, "");
    const erotic = buildEncounterTensionDirective(strangerScenario, "", {
      includePhysicalExchange: true,
    });

    expect(conversation).toContain("次の3点を毎ターン反映する");
    expect(conversation).toContain("3. 内面の描写");
    expect(conversation).not.toContain("4.");
    expect(erotic).toContain("次の4点を毎ターン反映する");
    expect(erotic).toContain("4. 内面の描写");
  });
});

// #1460: phase12 で足した「積み上がっとらんものを先取りせん」は phase13 では効いたが、
// phase14/phase15（.work/e2e-results/vlong-dogfood/2026-08-17-phase14,15）のターン1で
// 同じ「これからも、お話しできますか？」が再発した。文面は変わらん抽象的な注意のままで、
// モデルがどの程度守るかは運任せになっとった。
//
// 実際に交わした往復数はコードが数えられる具体的な事実。「まだ1往復だけ」は評価ではなく
// 観測値なので、no-injected-ai-filterの見分け方（消したらキャラ設定どおりに振る舞える
// ようになるか）に照らしても、これは足して良い側——シーンが実際に積み上がった量を
// 伝えるだけで、態度も禁止語も指定せん。
describe("実際に積み上がった往復数を具体的な事実として渡す", () => {
  it("exchangeCountを渡すと、継続性の指示に実際の往復数を含める", () => {
    const directive = buildEncounterTensionDirective(strangerScenario, "", {
      exchangeCount: 1,
    });

    expect(directive).toContain("まだ1往復だけ");
    expect(directive).toContain("積み上がっとらんものを先取りせん");
  });

  it("exchangeCountを渡さない時は従来どおり抽象的な文言のまま", () => {
    const directive = buildEncounterTensionDirective(strangerScenario, "");

    expect(directive).toContain("【シナリオ】に書かれた分だけ");
    expect(directive).not.toContain("往復だけ");
  });

  it("既存関係のキャラにはexchangeCountを渡しても継続性の指示自体が出ない", () => {
    const directive = buildEncounterTensionDirective("結婚して10年になる妻との夜。", "", {
      exchangeCount: 1,
    });

    expect(directive).not.toContain("積み上がっとらんものを先取りせん");
    expect(directive).not.toContain("往復");
  });

  it("態度やフィルタ文言を追加しない（見分け方: 消してもキャラ設定どおりに振る舞える）", () => {
    const directive = buildEncounterTensionDirective(strangerScenario, "", {
      exchangeCount: 1,
    });

    for (const forbidden of ["合意", "同意", "セーフワード", "境界", "配慮", "倫理"]) {
      expect(directive).not.toContain(forbidden);
    }
  });
});
