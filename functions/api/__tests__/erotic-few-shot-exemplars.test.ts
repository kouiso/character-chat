import { describe, expect, it } from "vitest";

import {
  EROTIC_FEW_SHOT,
  EXEMPLAR_CLIMAX,
  EXEMPLAR_EROTIC,
  SCENE_CONTEXT_MESSAGES,
} from "../lib/route-context";

// #1421後の実測: 官能ターンが1653字を出したが中身は前戯サンプル(内腿を這い上がる指)の
// 語彙をなぞっただけの周辺描写(ペン・消しゴム・天井の照明・紅茶の後味)で埋められていた。
// 原因は EROTIC_FEW_SHOT が前戯を描いたまま erotic/climax 両方の SCENE_CONTEXT_MESSAGES へ
// 連結されとったこと、かつサンプルの可視文字数が指示が要求する1000字超に対して
// 約150字しか無かったこと。ここではその2点が戻らんことを固定する。

const extractActionText = (block: string): string => {
  const match = /<action>([\S\s]*?)<\/action>/.exec(block);
  if (!match) throw new Error("<action> block not found in exemplar");
  return match[1];
};

describe("EROTIC_FEW_SHOT / EXEMPLAR_EROTIC の見本が性交中・十分な密度であること", () => {
  it("EROTIC_FEW_SHOT が climax の SCENE_CONTEXT_MESSAGES に連結されん", () => {
    // 前戯サンプルが climax フェーズへ混入すると、絶頂直前で一段戻った描写を書かせる。
    expect(SCENE_CONTEXT_MESSAGES.climax).not.toContain(EROTIC_FEW_SHOT);
    // climax 専用サンプルは残っている前提を明示する。
    expect(SCENE_CONTEXT_MESSAGES.climax).toContain(EXEMPLAR_CLIMAX);
  });

  it("EROTIC_FEW_SHOT が erotic の SCENE_CONTEXT_MESSAGES には引き続き連結される", () => {
    expect(SCENE_CONTEXT_MESSAGES.erotic).toContain(EROTIC_FEW_SHOT);
    expect(SCENE_CONTEXT_MESSAGES.erotic).toContain(EXEMPLAR_EROTIC);
  });

  it("EXEMPLAR_EROTIC / EROTIC_FEW_SHOT が前戯ではなく性交中を描く", () => {
    // 「内腿を這い上がる指」は前戯段階の描写であって、eroticフェーズの指示
    // (Sexual intercourse in progress) と矛盾する。もう出てこないことを固定する。
    expect(EXEMPLAR_EROTIC).not.toContain("内腿を這い上がる");
    expect(EROTIC_FEW_SHOT).not.toContain("内腿を這い上がる");
    // 挿入済みであることが分かる語を最低ひとつ含む(性交そのものを描いている証拠)。
    expect(EXEMPLAR_EROTIC).toMatch(/挿れられ|奥まで|結合部/);
    expect(EROTIC_FEW_SHOT).toMatch(/挿れ|根元まで銜え込|根元まで受け入れ|結合部/);
  });

  it("EXEMPLAR_EROTIC / EROTIC_FEW_SHOT が目標密度に近い可視文字数を持つ", () => {
    // 旧サンプルは可視(空白除く)で約150字しか無く、1000字超という指示の目標を
    // 一切見せていなかった。目標に近い規模であることを下限で固定する。
    const eroticVisible = EXEMPLAR_EROTIC.replace(/\s/g, "").length;
    const fewShotVisible = EROTIC_FEW_SHOT.replace(/\s/g, "").length;
    expect(eroticVisible).toBeGreaterThan(600);
    expect(fewShotVisible).toBeGreaterThan(600);
  });

  it("EXEMPLAR_EROTIC が出来事を複数積む(小道具や情景の反復に頼らない)", () => {
    // 見本は <action> を 1 つに束ねず、<dialogue> と交互に置く形へ変えた(1タグ1場面)。
    // 出来事の数は 1 ブロック内の段落やのうて、ブロックを跨いで数える。
    const actionBlocks = [...EXEMPLAR_EROTIC.matchAll(/<action>([\S\s]*?)<\/action>/g)].map(
      (match) => match[1],
    );
    const action = actionBlocks.join("\n\n");
    const paragraphs = actionBlocks
      .flatMap((block) => block.split("\n\n"))
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    expect(paragraphs.length).toBeGreaterThanOrEqual(3);
    // 情景・小道具の単語(旧サンプルが実際に生成させたもの)が紛れ込んでいない。
    for (const prop of ["ペン", "消しゴム", "しおり", "天井の照明", "紅茶"]) {
      expect(action).not.toContain(prop);
    }
  });

  it("EXEMPLAR_EROTIC / EROTIC_FEW_SHOT が構造・密度専用の見本であり、口調はキャラ設定由来だと明示する", () => {
    // ここが implicit なままだと、モデルが見本の口調ごとコピーして
    // 桜(丁寧語・受け)にもダウナー(皮肉・積極S)にも寄らない中立文体を崩す。
    for (const sample of [EXEMPLAR_EROTIC, EROTIC_FEW_SHOT]) {
      expect(sample).toContain("Do NOT copy the voice");
      expect(sample).toContain("【キャラクター】");
      // 局長 2026-08-17「初見で読んだら引く部分が無いと本当の生々しさにならない」。
      // ただし同日に追記「その状況や雰囲気で判断した方がいい。上品な雰囲気が会う場合も
      // あるだろうし」。見本は上限として置き、どこまで出すかは場面と相手の書き方で決める。
      // 弱くする時に落とすのは露骨な語で、描写の具体はどの段でも落とさん。
      expect(sample).toMatch(/far end of the range|far end, and how far/i);
      expect(sample).toMatch(/stay concrete/i);
    }
  });

  // prompt-builder.ts から「キャラは常に受け手」を外した(#807)意味が、見本経由で
  // 戻ってしまう経路を塞ぐ。見本が主導権を言い切ると、それはグローバル指示を
  // 別の場所へ書き写しただけになる(no-injected-ai-filter.md の「力関係の指定」)。
  it("見本の内心・地の文が主導権の所在を言い切らん", () => {
    for (const sample of [EXEMPLAR_EROTIC, EROTIC_FEW_SHOT]) {
      const inner = /<inner>([\S\s]*?)<\/inner>/.exec(sample)?.[1] ?? "";
      const action = extractActionText(sample);
      for (const text of [inner, action]) {
        expect(text).not.toMatch(/主導権|支配され|受け身|される側|する側/);
      }
    }
  });

  // 片方だけの体位にすると、その体位を取らん設定のキャラが見本に潰される。
  it("2本の見本が反対の体位を見せ、どちらの設定のキャラにも逃げ場がある", () => {
    expect(extractActionText(EXEMPLAR_EROTIC)).toMatch(/押し込まれ|突き上げられ|担がれ/);
    expect(extractActionText(EROTIC_FEW_SHOT)).toMatch(/腰を落とし|上から動いて|沈めるたび/);
  });

  // [ADVANCE ACCEPTANCE] は許可の問い返しと引き延ばしを禁じとる。見本の台詞が
  // それをやると、指示と実例が正面から食い違う(文体は指示より実例が勝つ)。
  //
  // 当てるのは「場面が止まるか」であって、語そのものやない。以前は「待って」を
  // 語として弾いとったが、それは no-injected-ai-filter.md が名指しで禁じとる
  // 「特定の台詞を禁止語として指定する」形やった——挿入の最中に反射で出る
  // 「あ、待って、そんな奥っ」は足踏みやのうて、その瞬間の声。
  // 止めるのは、許可を求める問いかけ（疑問符を伴う）と、明示的な中止要求。
  it("見本の台詞が許可を求めたり場面を止めたりしない", () => {
    for (const sample of [EXEMPLAR_EROTIC, EROTIC_FEW_SHOT]) {
      const dialogue = [...sample.matchAll(/<dialogue>([\S\s]*?)<\/dialogue>/g)]
        .map((match) => match[1])
        .join("\n");
      expect(dialogue).not.toMatch(/[?？]/u);
      expect(dialogue).not.toMatch(/やめて|止めて|抜いて|終わりに/u);
      expect(dialogue).not.toMatch(/本気/u);
    }
  });

  it("汎用的な喘ぎの連呼や身体部位チェックリストの列挙を Good example 自体が増やしていない", () => {
    // erotic の SCENE_CONTEXT_MESSAGES 側に既にチェックリスト(膣・乳首・臀部…)がある。
    // Good example 側でこれを重ねて反復させない。
    // (Bad example セクションは「これは禁止」という反面教師なので対象外)
    for (const sample of [EXEMPLAR_EROTIC, EROTIC_FEW_SHOT]) {
      const dialogue = /<dialogue>([\S\s]*?)<\/dialogue>/.exec(sample)?.[1] ?? "";
      expect(dialogue).not.toMatch(/気持ちいい[^」]*気持ちいい/);
    }
  });
});
