// @vitest-environment node
import { describe, expect, it } from "vitest";

import { POSTURE_TERMS } from "../../../src/lib/posture-map";
import {
  countDistinctContentChars,
  countUiVisibleChars,
  extractUiVisibleText,
  runQualityChecks,
} from "../../../src/lib/quality-guard";
import { stripXmlTags } from "../../../src/lib/xml-response-parser";
import {
  passesEveryNonLengthCheck,
  passesEveryDemotingCheck,
  preferNextAttemptForFloor,
} from "../lib/route-context";

import type { QualityCheckContext } from "../../../src/lib/quality-guard";

// #1470 で選別の物差しが passesEveryNonLengthCheck（全チェック通過）から
// passesEveryDemotingCheck（読めん壊れだけを見る）へ変わった。実測 phase43→45 で
// 化粧品レベルの指摘 1 個（repeated-block-lead）が長い erotic 応答（1150字）を
// 「フロア未達」扱いに落とし、324字の短い応答に負けとった。ここは「化粧品レベルの
// 指摘は降格させん／読めん壊れは降格させる」の境界を、実際にチェックが発火する本文で確かめる。
const CONVERSATION_CONTEXT: QualityCheckContext = { phase: "conversation" };

describe("passesEveryDemotingCheck は化粧品レベルの指摘で降格させん", () => {
  // 4段落とも先頭3文字「静かな」で始まる。checkNoRepeatedBlockLead の上限(4)に
  // ちょうど当たる本文。action/dialogue を交互に置いて body-wall には当たらせん。
  const repeatedLeadResponse = [
    "<response>",
    "<action>静かな図書室に西日が差し込んでいた。木の椅子がわずかに軋む音だけが響く午後だった。</action>",
    "<dialogue>「今日は静かだね」</dialogue>",
    "<action>静かな廊下を渡る風が、開いた窓からカーテンを揺らしていた。埃の匂いが混じっていた。</action>",
    "<dialogue>「本を読むにはちょうどいい日だと思う」</dialogue>",
    "<action>静かな図書室の奥では、返却された本の山がそのまま積まれていた。整理は後回しにされていた。</action>",
    "<dialogue>「片付けは明日でいいかな、って思っていたところ」</dialogue>",
    "<action>静かな時間が流れる中、壁の時計の針だけが規則正しく動き続けていた。</action>",
    "<dialogue>「こういう時間、意外と好きなんだ」</dialogue>",
    "<inner>誰にも急かされない、この時間がずっと続けばいいのにと思った。</inner>",
    "</response>",
  ].join("");

  it("repeated-block-lead が実際に発火する", () => {
    const result = runQualityChecks(repeatedLeadResponse, CONVERSATION_CONTEXT);
    expect(result.failures?.map((f) => f.failedCheck)).toContain("repeated-block-lead");
  });

  it("全チェック通過(passesEveryNonLengthCheck)は false", () => {
    expect(passesEveryNonLengthCheck(repeatedLeadResponse, CONVERSATION_CONTEXT)).toBe(false);
  });

  it("読める壊れだけを見る(passesEveryDemotingCheck)は true", () => {
    expect(passesEveryDemotingCheck(repeatedLeadResponse, CONVERSATION_CONTEXT)).toBe(true);
  });
});

describe("passesEveryDemotingCheck は読めん壊れで降格させる", () => {
  // <action> 1個に地の文を6行積み上げた壁。WALL_RENDERED_LINE_RUN(6)にちょうど当たる。
  const bodyWallResponse = [
    "<response>",
    "<action>",
    "そこにはただ長い文章が延々と続いていた。",
    "今度はまた別の一文がここに置かれていた。",
    "更に別の一文が積み重なっていく様子だった。",
    "段落と呼ぶには長すぎる連なりがまだ続いていた。",
    "読み手はまだ次の文を静かに待っていた。",
    "そしてまだ終わる気配のない一文がそこにあった。",
    "</action>",
    "<dialogue>「これでようやく終わりにしよう」</dialogue>",
    "<inner>長すぎる独白だったと自分でも感じていた。</inner>",
    "</response>",
  ].join("\n");

  it("body-wall が実際に発火する", () => {
    const result = runQualityChecks(bodyWallResponse, CONVERSATION_CONTEXT);
    expect(result.failures?.map((f) => f.failedCheck)).toContain("body-wall");
  });

  // 2026-08-20 に反転させた。元は「長い壁は短い抜けより読めん」で降格側に置いとったが、
  // その判断の根拠になった本文は 1 ブロック 504 字で末尾の <inner> ごと落ちとって、
  // そっちは inner-missing でも降格する（下の describe が固定しとる）。
  // 実測 phase58/59: 抜き所の 5 ターンが、続き書きでフロアを超えた本文（可視 1051〜1150）を
  // 作った上で body-wall だけで降格させ、402〜616 字の短い試行を配っとった。
  // 読み手にとっては「エロが短い」という最初の不満そのものへ戻る。
  it("壁だけなら降格させん（長い本文をそのまま配る）", () => {
    expect(passesEveryDemotingCheck(bodyWallResponse, CONVERSATION_CONTEXT)).toBe(true);
  });

  it("壁に <inner> 落ちが重なったら降格させる", () => {
    const withoutInner = bodyWallResponse.replace(
      "<inner>長すぎる独白だったと自分でも感じていた。</inner>\n",
      "",
    );

    expect(passesEveryDemotingCheck(withoutInner, CONVERSATION_CONTEXT)).toBe(false);
  });
});

describe("passesEveryDemotingCheck はXML破損で降格させる", () => {
  // 2つ目の<action>が閉じタグを持たん。開始2個・終了1個で xml-tags-unbalanced に当たる。
  const brokenXmlResponse = [
    "<response>",
    "<action>それは静かな午後だった。誰もいない教室に光が差し込んでいた。</action>",
    "<action>もう一つの地の文がここに続いていたが、まだ閉じられていなかった。",
    "<dialogue>「今日はこれで終わりにしよう」</dialogue>",
    "<inner>思っていたことを言葉にしてみた気がした。</inner>",
    "</response>",
  ].join("\n");

  it("xml-tags-unbalanced が実際に発火する", () => {
    const result = runQualityChecks(brokenXmlResponse, CONVERSATION_CONTEXT);
    expect(result.failures?.map((f) => f.failedCheck)).toContain("xml-tags-unbalanced");
  });

  it("読める壊れだけを見る(passesEveryDemotingCheck)は false", () => {
    expect(passesEveryDemotingCheck(brokenXmlResponse, CONVERSATION_CONTEXT)).toBe(false);
  });
});

describe("preferNextAttemptForFloor の統合: フロア到達・可視1150字がフロア未達・可視400字に勝つ", () => {
  it("nextDistinct/currentDistinct は可視文字数と同じ値で、長い方(next)が勝つ", () => {
    expect(
      preferNextAttemptForFloor({
        nextDistinct: 1150,
        nextVisible: 1150,
        currentDistinct: 400,
        currentVisible: 400,
        minChars: 820,
        nextReadable: true,
        currentReadable: true,
      }),
    ).toBe(true);
  });
});

// 上の統合テストは nextReadable/currentReadable を手で渡しとるだけで、
// passesEveryDemotingCheck を一度も通してへん。ここは選別が実際に使う経路
// （本文 → passesEveryDemotingCheck → readable、本文 → countUiVisibleChars/
// countDistinctContentChars → 可視・重複除去分量）をそのまま辿って、化粧品レベルの
// 指摘（repeated-block-lead）しか無い長い試行が、短くて無傷な試行に勝つことを確かめる。
// passesEveryDemotingCheck の中身を passesEveryNonLengthCheck 相当（全チェック通過）に
// 戻すと、この 1 本だけが赤になることを手で確認済み（実装は戻していない）。
describe("実本文での統合: 化粧品レベルの指摘だけの長い試行が、無傷な短い試行に勝つ", () => {
  // テスト1と同じ骨格（同じ書き出し「静かな」の段落）を、フロア820字に可視文字が
  // 届くまで段落を増やして伸ばした本文。repeated-block-lead 以外は発火させん。
  const longCosmeticOnlyResponse = [
    "<response>",
    "<action>静かな図書室に西日が差し込んでいた。木の椅子がわずかに軋む音だけが響く午後だった。窓の外では欅の葉が風に揺れて、時折鳥の声が遠くから聞こえてくる。埃っぽい紙の匂いが漂う中、時計の針だけが規則正しく進んでいた。</action>",
    "<dialogue>「今日は静かだね。こんな午後、久しぶりな気がする」</dialogue>",
    "<action>静かな廊下を渡る風が、開いた窓からカーテンを揺らしていた。木の床を踏む足音は響かず、壁に掛かった古い絵画だけが変わらずそこにあった。遠くの教室からわずかに椅子を引く音が聞こえたが、すぐにまた静けさへ戻っていった。</action>",
    "<dialogue>「本を読むにはちょうどいい日だと思う。急ぐ用事もないし」</dialogue>",
    "<action>静かな図書室の奥では、返却された本の山がそのまま積まれていた。整理は後回しにされ、背表紙の色だけが並んで見えていた。カウンターの照明は半分落とされていて、昼でも薄暗い一角がそこだけ残っていた。</action>",
    "<dialogue>「片付けは明日でいいかな、って思っていたところ。今日はゆっくりしたい」</dialogue>",
    "<action>静かな時間が流れる中、壁の時計の針だけが規則正しく動き続けていた。誰かが席を立つ気配もなく、ページをめくる乾いた音だけが等間隔に繰り返されていた。外の光がゆっくりと角度を変えて、床に落ちる影を少しずつ伸ばしていった。</action>",
    "<dialogue>「こういう時間、意外と好きなんだ。何もしなくていい気がして」</dialogue>",
    "<action>静かな中庭に面した窓辺には、鉢植えの緑がひとつだけ置かれていた。水やりを忘れられたのか葉先はわずかに萎れていて、それでも陽の当たる場所を選んだように傾いていた。ベンチの木目には長年の使用で丸みが生まれていた。</action>",
    "<dialogue>「あの鉢植え、誰の当番だったか覚えてる？そろそろ水をあげないと」</dialogue>",
    "<action>静かな棚の隅には、貸出履歴の途絶えた古い辞典が並んでいた。表紙の角は擦れて丸くなり、栞代わりの紙片が一枚だけ挟まったままだった。誰かが読み返す日を待つように、その一角だけ時間が止まっていた。</action>",
    "<dialogue>「懐かしいな、これ。昔よく借りてた気がする」</dialogue>",
    "<action>静かな受付の机には、来館者の記入した貸出カードが数枚だけ残されていた。インクの色が微妙に違うのは、書いた時期がそれぞれ離れているからだった。誰も取りに来ないまま、その紙束だけが引き出しの奥で埃をかぶっていた。</action>",
    "<dialogue>「あれ、誰かの忘れ物かな。名前も書いてないみたいだけど」</dialogue>",
    "<inner>誰にも急かされない、この時間がずっと続けばいいのにと思った。</inner>",
    "</response>",
  ].join("");

  // 全チェック通過・repeated-block-lead も起こさん、短くきれいな本文。
  const shortCleanResponse = [
    "<response>",
    "<action>夕方の教室にはもう誰もいなかった。窓から差し込む光だけが机の上をゆっくり滑っていた。黒板の隅に消し残された文字が、うっすらと影を落としていた。掃除当番の名簿だけが、扉のそばに貼られたままになっていた。</action>",
    "<dialogue>「今日は付き合ってくれてありがとう。楽しかった」</dialogue>",
    "<action>廊下の奥から掃除道具を片付ける音が小さく響いていた。昇降口の扉が風でわずかに揺れ、金具の鳴る音が一度だけ聞こえた。下駄箱の奥にはまだ誰かの上履きが片方だけ残されていた。</action>",
    "<dialogue>「またこうやって話せる時間があるといいな。次はいつにする？」</dialogue>",
    "<action>外に出ると空は橙色に染まっていて、雲の輪郭がくっきりと浮かんでいた。自転車置き場にはもう数台しか残っていなかった。校門の脇に立つ木の影が、アスファルトの上に長く伸びていた。</action>",
    "<dialogue>「今度は駅前のカフェにでも寄ってみようか。話したいこと、まだあるし」</dialogue>",
    "<inner>少しだけ気持ちが軽くなった気がした。</inner>",
    "</response>",
  ].join("");

  const FLOOR = 820;

  it("前提: 長い試行は repeated-block-lead だけが発火し、短い試行は無傷", () => {
    expect(
      runQualityChecks(longCosmeticOnlyResponse, CONVERSATION_CONTEXT).failures?.map(
        (f) => f.failedCheck,
      ),
    ).toEqual(["repeated-block-lead"]);
    expect(runQualityChecks(shortCleanResponse, CONVERSATION_CONTEXT).passed).toBe(true);
  });

  it("前提: 長い試行の可視文字数はフロアを超え、短い試行は届かん", () => {
    expect(countUiVisibleChars(longCosmeticOnlyResponse)).toBeGreaterThanOrEqual(FLOOR);
    expect(countUiVisibleChars(shortCleanResponse)).toBeLessThan(FLOOR);
  });

  it("passesEveryDemotingCheck / countUiVisibleChars / countDistinctContentChars を実本文へ通し、選別で長い方が勝つ", () => {
    const nextReadable = passesEveryDemotingCheck(longCosmeticOnlyResponse, CONVERSATION_CONTEXT);
    const currentReadable = passesEveryDemotingCheck(shortCleanResponse, CONVERSATION_CONTEXT);
    // repeated-block-lead は化粧品レベルの指摘なので、実本文を通しても readable は true のまま。
    expect(nextReadable).toBe(true);
    expect(currentReadable).toBe(true);

    const nextVisible = countUiVisibleChars(longCosmeticOnlyResponse);
    const currentVisible = countUiVisibleChars(shortCleanResponse);
    const nextDistinct = countDistinctContentChars(stripXmlTags(longCosmeticOnlyResponse));
    const currentDistinct = countDistinctContentChars(stripXmlTags(shortCleanResponse));

    expect(
      preferNextAttemptForFloor({
        nextDistinct,
        nextVisible,
        currentDistinct,
        currentVisible,
        minChars: FLOOR,
        nextReadable,
        currentReadable,
      }),
    ).toBe(true);
  });
});

// 敵対レビュー指摘: 上のテストは全部 phase:"conversation"。今回の実被害
// （erotic が 1150→324字に落ちた件）に一番近い erotic/climax の経路が1本も無い。
// ここは erotic/climax の文脈（longResponseMinChars 込み）で、降格させんチェックと
// 降格させるチェックの境界を実際に発火する本文で確かめる。
// sensual-abstract は今回の境界（DEMOTION_EXEMPT_QUALITY_CHECKS）と無関係な別チェックなので、
// skipSensualSpecificityCheckで外し、狙ったチェックだけを発火させる。
const EROTIC_CONTEXT: QualityCheckContext = {
  phase: "erotic",
  longResponseMinChars: 820,
  skipSensualSpecificityCheck: true,
};
const CLIMAX_CONTEXT: QualityCheckContext = {
  phase: "climax",
  longResponseMinChars: 900,
  skipSensualSpecificityCheck: true,
};

// フロア(820/900字)を満たしつつ、狙ったチェック以外を発火させんための共通パディング。
// 各段落は書き出し3文字が重ならん（repeated-block-lead回避）・「彼女は/彼は」構文や
// 二人称を使わん（third-person-narration・stray-second-person回避）よう組んである。
const FLOOR_PADDING = [
  "<action>静かな寝室にはオレンジ色の常夜灯だけが灯っていて、壁にゆらゆらとした影を落としていた。</action>",
  "<action>窓の外では小雨が降り始めていて、屋根を叩く音がかすかに響いていた。</action>",
  "<dialogue>「ん、そう」</dialogue>",
  "<action>枕元に置かれた時計の針は、もう深夜を大きく回っていた。</action>",
  "<action>敷布の皺は動いた分だけ複雑に折り重なっていた。</action>",
  "<dialogue>「もう少しだけ」</dialogue>",
  "<action>エアコンの送風音だけが、途切れることなく部屋を満たしていた。</action>",
  "<action>カーテンの隙間から差し込む月明かりが、床に細い線を描いていた。</action>",
  "<dialogue>「うん、平気」</dialogue>",
  "<action>隣の部屋からは物音一つ聞こえず、建物全体が寝静まっているようだった。</action>",
  "<action>脱いだ服が椅子の背にかけられ、灯りの下でぼんやりと輪郭を見せていた。</action>",
  "<dialogue>「ゆっくりでいい」</dialogue>",
  "<action>冷蔵庫の低い駆動音が、廊下の向こうから途切れ途切れに届いていた。</action>",
  "<action>枕元のグラスには、飲みかけの水がまだ半分残っていた。</action>",
  "<dialogue>「うん」</dialogue>",
  "<action>遠くを走る車のヘッドライトが、天井を一瞬だけ横切っていった。</action>",
  "<action>換気扇の羽根が回る音が、規則正しいリズムを刻んでいた。</action>",
  "<dialogue>「大丈夫」</dialogue>",
  "<action>玄関のドアの隙間から、廊下の灯りがわずかに漏れ込んでいた。</action>",
  "<action>壁掛けのカレンダーは、めくられないまま先月のページで止まっていた。</action>",
  "<dialogue>「そういえば、明日は休みだったね」</dialogue>",
  "<action>本棚の隅には、読みかけのまま伏せられた文庫本が置かれていた。</action>",
  "<action>玄関マットの端が少しめくれて、廊下の光を細く映し込んでいた。</action>",
  "<dialogue>「片付けは、また今度でいいよね」</dialogue>",
  "<action>台所の蛇口から、ぽたりと一滴だけ水が落ちる音がした。</action>",
  "<action>洗濯物の籠には、畳まれないままの衣類が山になっていた。</action>",
  "<dialogue>「洗濯、明日でいいから」</dialogue>",
  "<action>玄関先の傘立てには、色違いの傘が二本並んで立てかけてあった。</action>",
  "<action>郵便受けには、まだ取り込んでいない広告の束が挟まっていた。</action>",
  "<dialogue>「郵便、明日でいいよ」</dialogue>",
  "<action>ベランダの植木鉢には、水やりを忘れられた葉が少ししおれていた。</action>",
  "<action>台所のテーブルには、飲みかけのコーヒーカップがそのまま置かれていた。</action>",
  "<dialogue>「コーヒー、冷めちゃったね」</dialogue>",
  "<action>本棚の上段には、埃をかぶった写真立てが一つだけ置かれていた。</action>",
  "<action>廊下の突き当たりの窓は、鍵をかけたまま長く開けられていなかった。</action>",
  "<dialogue>「今度、窓拭きでもしようか」</dialogue>",
  "<action>玄関の靴箱には、季節外れのサンダルがまだしまわれずに残っていた。</action>",
  "<action>テレビの上には、ほこりの積もったリモコンが二つ並んでいた。</action>",
  "<dialogue>「テレビ、今日はつけなくていいや」</dialogue>",
  "<action>寝室の隅に置かれた加湿器は、電源を入れられないまま静かに佇んでいた。</action>",
  "<action>クローゼットの奥には、去年の冬に着ていたコートがまだ吊るされていた。</action>",
  "<dialogue>「コート、そろそろクリーニングに出さないと」</dialogue>",
].join("");

describe("passesEveryDemotingCheck: erotic/climaxの実文脈で降格させるチェックが正しく降格させる", () => {
  it("user-perspective-ejaculation: 射精の視点がユーザー側になる本文は降格させる(climax)", () => {
    const response = [
      "<response>",
      "<dialogue>「きみの中に、このまま全部出すから」</dialogue>",
      "<action>吐息が触れるほど近くで、視線がまっすぐ絡み合っていた。</action>",
      FLOOR_PADDING,
      "<inner>言葉にできない気持ちが胸の奥で渦を巻いていた。</inner>",
      "</response>",
    ].join("");

    expect(
      runQualityChecks(response, CLIMAX_CONTEXT).failures?.map((f) => f.failedCheck),
    ).toContain("user-perspective-ejaculation");
    expect(passesEveryDemotingCheck(response, CLIMAX_CONTEXT)).toBe(false);
  });

  it("other-character-name: 他キャラの名前が混入した本文は降格させる(erotic)", () => {
    const context: QualityCheckContext = { ...EROTIC_CONTEXT, otherCharacterNames: ["涼太"] };
    const response = [
      "<response>",
      "<action>ふと視線をそらした拍子に、涼太の忘れていった上着が椅子にかかっているのが目に入った。</action>",
      "<dialogue>「これ、片付けておかないとね」</dialogue>",
      FLOOR_PADDING,
      "<inner>関係のない名前が頭をよぎって、少しだけ気が散った。</inner>",
      "</response>",
    ].join("");

    expect(runQualityChecks(response, context).failures?.map((f) => f.failedCheck)).toContain(
      "other-character-name",
    );
    expect(passesEveryDemotingCheck(response, context)).toBe(false);
  });

  it("forbidden-character-word: キャラシートの禁止語を発話した本文は降格させる(erotic)", () => {
    const context: QualityCheckContext = { ...EROTIC_CONTEXT, forbiddenWords: ["せんせい"] };
    const response = [
      "<response>",
      "<action>視線が合った瞬間、少しだけ間が空いた。</action>",
      "<dialogue>「せんせい、待たせちゃったね」</dialogue>",
      FLOOR_PADDING,
      "<inner>呼び方を間違えたことに、自分でもすぐ気づいた。</inner>",
      "</response>",
    ].join("");

    expect(runQualityChecks(response, context).failures?.map((f) => f.failedCheck)).toContain(
      "forbidden-character-word",
    );
    expect(passesEveryDemotingCheck(response, context)).toBe(false);
  });

  it("posture-mismatch: 指定体位(正常位)のcueが1つも出ん本文は降格させる(erotic)", () => {
    const seijouiPosture = POSTURE_TERMS.find((posture) => posture.id === "seijoui");
    if (!seijouiPosture) throw new Error("posture-map から seijoui が見つからん");
    const context: QualityCheckContext = { ...EROTIC_CONTEXT, requestedPostures: [seijouiPosture] };
    const response = [
      "<response>",
      "<action>抱き合ったまま、視線だけがゆっくりと絡み合っていた。</action>",
      "<dialogue>「今日はこのままでいたいな」</dialogue>",
      FLOOR_PADDING,
      "<inner>指定された姿勢とは違う描写のまま、時間だけが過ぎていった。</inner>",
      "</response>",
    ].join("");

    expect(runQualityChecks(response, context).failures?.map((f) => f.failedCheck)).toContain(
      "posture-mismatch",
    );
    expect(passesEveryDemotingCheck(response, context)).toBe(false);
  });
});

describe("passesEveryDemotingCheck: erotic の実文脈でも within-turn-repetition は降格させん", () => {
  // 書き出し3文字だけ変えた、ほぼ同一の文を2つ埋め込む。checkWithinTurnRepetitionの
  // Jaccard類似度判定(閾値0.72)に当てるためで、repeated-block-lead(書き出しの一致)は
  // 意図的に外してある——このテストの狙いはwithin-turn-repetition単体の免除確認やから。
  const response = [
    "<response>",
    "<action>静かな夜、二人の吐息だけがゆっくりと重なっていく。</action>",
    "<dialogue>「このままでいたい」</dialogue>",
    "<action>薄暗い夜、二人の吐息だけがゆっくりと重なっていく。</action>",
    FLOOR_PADDING,
    "<inner>同じ夜が二度繰り返されているような、不思議な感覚だった。</inner>",
    "</response>",
  ].join("");

  it("前提: within-turn-repetition だけが発火する", () => {
    expect(runQualityChecks(response, EROTIC_CONTEXT).failures?.map((f) => f.failedCheck)).toEqual([
      "within-turn-repetition",
    ]);
  });

  it("前提: 可視文字数はフロア(820字)を超える", () => {
    expect(countUiVisibleChars(response)).toBeGreaterThanOrEqual(820);
  });

  it("passesEveryDemotingCheck は true（免除対象なので降格させん）", () => {
    expect(passesEveryDemotingCheck(response, EROTIC_CONTEXT)).toBe(true);
  });
});

describe("preferNextAttemptForFloor: <inner>への水増しは勝たん(extractUiVisibleText基準)", () => {
  // 同じ action+dialogue の1組をそのまま3回コピペし、<inner>だけに200字超・全部違う文を足す。
  // 敵対レビュー(2026-08-19)が実測で再現した水増し（同じ1組を3回貼っても<inner>238字を
  // 足せば比率0.325→0.551で通っていた旧実装）を、extractUiVisibleTextで<inner>を
  // 除いた今の実装で再現しても勝たんことを確かめる。
  const paddedRepeatedTriple = [
    "<response>",
    "<action>夜の静けさの中で、二人は静かに寄り添っていた。</action>",
    "<dialogue>「そばにいて」</dialogue>",
    "<action>夜の静けさの中で、二人は静かに寄り添っていた。</action>",
    "<dialogue>「そばにいて」</dialogue>",
    "<action>夜の静けさの中で、二人は静かに寄り添っていた。</action>",
    "<dialogue>「そばにいて」</dialogue>",
    "<inner>",
    "同じ夜が三度繰り返されているような不思議な感覚があった。",
    "時計の針が進む音だけが、やけにはっきりと聞こえていた。",
    "指先の温度がゆっくりと馴染んでいくのを感じていた。",
    "遠くで犬が一度だけ吠えて、またすぐに静かになった。",
    "カーテンの端が風もないのにわずかに揺れた気がした。",
    "自分の心拍がいつもより速いことに、今さら気づいた。",
    "言葉にしなくても伝わることがあるのだと、初めて思った。",
    "</inner>",
    "</response>",
  ].join("");

  // 無傷で短い、水増しの無い本文。1組しか無いぶんdistinctの実量では長い方が勝つはず、
  // という直感を確かめる比較対象。
  const shortCleanNext = [
    "<response>",
    "<action>静かな夜が更けていく中で、二人だけの時間がゆっくりと流れていた。窓の外では冷たい風が吹いていた。</action>",
    "<dialogue>「このままずっとこうしていたい」</dialogue>",
    "<inner>短くても、今のこの時間がいちばん落ち着く気がした。</inner>",
    "</response>",
  ].join("");

  it("実測: 3回コピペ+inner水増しのnextDistinctは、無傷な短い本文のcurrentDistinctを超えん", () => {
    const nextVisible = countUiVisibleChars(paddedRepeatedTriple);
    const currentVisible = countUiVisibleChars(shortCleanNext);
    const nextDistinct = countDistinctContentChars(extractUiVisibleText(paddedRepeatedTriple));
    const currentDistinct = countDistinctContentChars(extractUiVisibleText(shortCleanNext));

    // <inner>の200字超の水増しは、extractUiVisibleTextが<inner>を数えんため、
    // nextVisible/nextDistinctのどちらにも一切反映されん。3回コピペした中身も
    // countDistinctContentCharsの重複除去で1回分にしか数えられん。
    expect(nextDistinct).toBeLessThan(currentDistinct);

    const nextReadable = passesEveryDemotingCheck(paddedRepeatedTriple, EROTIC_CONTEXT);
    const currentReadable = passesEveryDemotingCheck(shortCleanNext, EROTIC_CONTEXT);
    expect(nextReadable).toBe(true);
    expect(currentReadable).toBe(true);

    // minCharsをどちらも届かん値にして、readable→distinct量の比較だけで決めさせる。
    expect(
      preferNextAttemptForFloor({
        nextDistinct,
        nextVisible,
        currentDistinct,
        currentVisible,
        minChars: 999_999,
        nextReadable,
        currentReadable,
      }),
    ).toBe(false);
  });
});
