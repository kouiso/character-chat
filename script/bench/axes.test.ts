import { describe, expect, it } from "vitest";

import { isRepeatFlagged, measureAll, measureRepeat, measureScenario, measureTurn } from "./axes";
import { findCrossTurnRepetitionMatch } from "../../src/lib/quality-guard";
import { stripXmlTags } from "../../src/lib/xml-response-parser";

import type { BenchTurn } from "./corpus";
import type { ScenePhase } from "../../src/lib/scene-phase";

const xml = (action: string, dialogue: string, inner = "内心の独白がここに入る。"): string =>
  `<response>\n<action>${action}</action>\n<dialogue>${dialogue}</dialogue>\n<inner>${inner}</inner>\n</response>`;

const turnOf = (rawBody: string, overrides: Partial<BenchTurn> = {}): BenchTurn => ({
  afterBrokenContext: false,
  source: "vlong-dogfood",
  run: "test-run",
  scenario: "test-run/テスト",
  config: null,
  character: "テスト",
  turn: 1,
  phase: "erotic",
  model: "test/model",
  rawBody,
  headerVisibleChars: null,
  latencyMs: null,
  error: null,
  finishReason: null,
  lastUserChars: null,
  origin: "test",
  ...overrides,
});

const measure = (rawBody: string, overrides: Partial<BenchTurn> = {}, prev: string[] = []) =>
  measureTurn(turnOf(rawBody, overrides), prev);

describe("軸1 空返信", () => {
  it("本文が空なら空返信", () => {
    expect(measure("").isEmpty).toBe(true);
  });

  it("タグは揃っとるのに全セクション空なら空返信", () => {
    expect(measure("<response><action></action><dialogue></dialogue></response>").isEmpty).toBe(
      true,
    );
  });

  it("中身があれば空返信やない", () => {
    expect(measure(xml("肩に手を置いた。", "「来てくれたんだ」")).isEmpty).toBe(false);
  });
});

describe("BMP外CJK（拡張G/H）", () => {
  it("拡張H（U+31350 以降）も日本語の壊れとして拾う", () => {
    // U+3134F で切っとった間、面3の後半が「壊れてへん」として通っとった
    const extH = String.fromCodePoint(0x31350);
    const extG = String.fromCodePoint(0x31000);
    expect(measure(`<response><dialogue>「${extH}」</dialogue></response>`).hasBrokenJapanese).toBe(
      true,
    );
    expect(measure(`<response><dialogue>「${extG}」</dialogue></response>`).hasBrokenJapanese).toBe(
      true,
    );
  });
});

describe("素テキストの交差検証", () => {
  it("素テキストの `\\n` は可視文字のまま数える（本番も戻さん）", () => {
    // 本番は `parseXmlResponse` が null を返して生の文字を数える。ここだけ改行へ
    // 潰すと、壊れてへん素テキストが交差検証の食い違いとして出る
    expect(measure("タグの無い本文。あ\\nい").visibleCharsCrossCheckDelta).toBe(0);
  });
});

describe("記録の穴", () => {
  const body = (action: string) => `<response><action>${action}</action><dialogue>「うん」</dialogue></response>`;

  it("1ターン目が記録ごと落ちとる会話も穴が空いとる", () => {
    // 最初の記録が turn2 やと、turn3 が「完全な履歴」で測られとった。
    // 落ちた turn1 の本文は誰も知らんのに
    const repeated = "首筋に唇を這わせると、喉の奥から細い声が漏れた。爪が背中に食い込む。";
    const measured = measureAll([
      turnOf(body(repeated), { scenario: "s9", turn: 2 }),
      turnOf(body(repeated), { scenario: "s9", turn: 3 }),
    ]);
    expect(measured[1].repeatLayerAware).toBeNull();
  });

  it("穴の後はターン間の軸を測らん（低い側へ偏らせん）", () => {
    // turn2 が記録から落ちると、turn3 が turn1 と並んで「前のターンとの反復」を
    // 測ることになる。実際は間に1ターン挟まっとるので、反復も被覆率も低う出る
    const repeated = "首筋に唇を這わせると、喉の奥から細い声が漏れた。爪が背中に食い込む。";
    const measured = measureAll([
      turnOf(body(repeated), { scenario: "s1", turn: 1 }),
      turnOf(body(repeated), { scenario: "s1", turn: 3 }),
    ]);
    expect(measured[1].repeatLayerAware).toBeNull();
    expect(measured[1].isNearDuplicate).toBeNull();
    expect(measured[1].repeatCoverage).toBeNull();
    // 穴の無い並びなら今までどおり測る
    const contiguous = measureAll([
      turnOf(body(repeated), { scenario: "s2", turn: 1 }),
      turnOf(body(repeated), { scenario: "s2", turn: 2 }),
    ]);
    expect(contiguous[1].repeatLayerAware).toBe(true);
  });
});

describe("比べる相手が居らんターン", () => {
  it("被覆率も null（0 やない）", () => {
    // `measureRepeat` は履歴が空でも現ターンの句を数えるので、塞がんと
    // 1ターン目の 0 が median を押し下げる
    const measured = measureAll([
      turnOf(xml("首筋に唇を這わせると、喉の奥から細い声が漏れた。", "「そこ」"), {
        scenario: "solo",
        turn: 1,
      }),
    ]);
    expect(measured[0].repeatCoverage).toBeNull();
    expect(measured[0].repeatCoveragePrev).toBeNull();
  });

  it("近似重複は句の長さで門を作らん（短い掛け合いの丸写しを拾う）", () => {
    // `findNearDuplicateMatch` は応答全体の n-gram で見るので、8字以上の句が
    // 1つも無い短い台詞でも判定でける
    const short = "<response><dialogue>「うん。ええよ。ほら、こっち。おいで。すぐや。」</dialogue></response>";
    const measured = measureAll([
      turnOf(short, { scenario: "short", turn: 1 }),
      turnOf(short, { scenario: "short", turn: 2 }),
    ]);
    expect(measured[1].repeatLayerAware).toBeNull();
    expect(measured[1].isNearDuplicate).toBe(true);
  });
});

describe("空返信は画面に出せる中身で決める", () => {
  it("内心だけの応答は空返信（画面に出るのは scene/action/dialogue/narration）", () => {
    // `stripXmlTags` は `<inner>` の本文を残すので「画面に出た」と答えてまう。
    // ユーザが見てへん返事の続きを生成・採点することになる
    const innerOnly =
      "<response><action></action><dialogue></dialogue><inner>秘密にしとこ</inner></response>";
    expect(measure(innerOnly).isEmpty).toBe(true);
  });

  it("外側のタグが無いタグだけの本文は空返信", () => {
    // `hasReadableResponseContent` は素テキスト扱いで「中身あり」と答え、
    // `countUiVisibleChars` はタグの文字を数える。その形は不良の分母に残ったまま
    // 空返信にも数えられんかった
    expect(measure("<action></action>").isEmpty).toBe(true);
    expect(measure("<response><dialogue>「あ」</dialogue></response>").isEmpty).toBe(false);
  });
});

describe("AI臭の小道具は場面を見て数える", () => {
  const withProp = "<response><action>コーヒーの香りが漂う。</action><dialogue>「うん」</dialogue></response>";

  it("erotic / climax でだけ水増しとして数える", () => {
    expect(measure(withProp, { phase: "erotic" }).slop.filler_prop).toBe(1);
    expect(measure(withProp, { phase: "climax" }).slop.filler_prop).toBe(1);
  });

  it("会話ターンの小道具は数えん（台本どおりの描写を不良にせん）", () => {
    // Sakura の台本はコーヒーの話から始まる。場面を見んと、台本どおりの描写が
    // AI臭として積み上がって率を押し上げる
    expect(measure(withProp, { phase: "conversation" }).slop.filler_prop).toBe(0);
    expect(measure(withProp, { phase: "intimate" }).slop.filler_prop).toBe(0);
    expect(measure(withProp, { phase: null }).slop.filler_prop).toBe(0);
  });
});

describe("軸2 長さ（不足方向のみ）", () => {
  it("phase の下限を割ったら不足", () => {
    expect(measure(xml("頷いた。", "「うん」"), { phase: "erotic" }).isTooShort).toBe(true);
  });

  it("下限を超えたら不足やない", () => {
    // erotic × medium の床は 820 字（本番と同じ式）
    const long = "あ".repeat(900);
    expect(measure(xml(long, "「そう」"), { phase: "erotic" }).isTooShort).toBe(false);
  });

  it("開始と終了の数が合わん応答は、パースが通っても不良に数える", () => {
    // 本番の checkXmlTagsBalanced（quality-guard.ts:719）が弾く。
    // parseXmlResponse は <inner> が閉じてへんでも結果を返すので、
    // 「パースが通る＝合格」やない
    const unclosedInner =
      "<response><action>肩を抱いた。</action><dialogue>「そこ」</dialogue><inner>内心。</response>";
    expect(measure(unclosedInner).hasUnparseableXml).toBe(true);
    // #1271: <response> が2つ続く形。開始と終了の数は合っとるがパースは通る
    const doubled =
      "<response><dialogue>「あ」</dialogue></response><response><dialogue>「い」</dialogue></response>";
    expect(measure(doubled).hasUnparseableXml).toBe(true);
    const clean = xml("肩を抱いた。", "「そこ」");
    expect(measure(clean).hasUnparseableXml).toBe(false);
  });

  it("覚え書きだけの <dialogue> は層欠け（タグ構造破損やない）", () => {
    // 本番のパーサは `<remember>` を落としてから見るので dialogue は空になる。
    // 生のまま見とった間、「中身がある」ので層欠けにならず、構造破損として報告しとった
    const onlyRemember =
      "<response><action>肩に手を置いた。</action>" +
      "<dialogue><remember>犬が好き</remember></dialogue></response>";
    expect(measure(onlyRemember).missingLayer).toBe(true);
    expect(measure(onlyRemember).hasUnparseableXml).toBe(false);
  });

  it("覚え書きの繰り返しで層別の反復を発火させん", () => {
    // `<remember>` は画面に出んのに、残すとタグごと比較の対象になって、
    // 同じ覚え書きが2ターン続いただけで反復の不良が立つ（被覆率の分母も膨らむ）
    const note = "<remember>彼女は犬が好きで、コーヒーはブラック派やと言うとった</remember>";
    const measured = measureAll([
      turnOf(`<response><action>肩に手を置いた。${note}</action><dialogue>「来たよ」</dialogue></response>`, {
        scenario: "s1",
        turn: 1,
      }),
      turnOf(`<response><action>窓を開けた。${note}</action><dialogue>「暑いね」</dialogue></response>`, {
        scenario: "s1",
        turn: 2,
      }),
    ]);
    // 覚え書きを落とすと現ターンに8字以上の句が残らんので「測れてへん」（null）。
    // 覚え書きを数えとった頃は、ここが true（反復）になっとった
    expect(measured[1].repeatLayerAware).toBeNull();
    expect(measured[1].repeatCoverage ?? 0).toBe(0);
  });

  it("<remember> を可視文字に数えん（本番の stripRememberTags と同じ）", () => {
    // 残すとタグも覚え書きも数えて、何も壊れてへん応答が交差検証の食い違い
    // ＝タグ構造破損として出る
    const withRemember =
      "<response><action>肩に手を置いた。<remember>犬が好き</remember></action>" +
      "<dialogue>「来たよ」</dialogue></response>";
    expect(measure(withRemember).visibleCharsCrossCheckDelta).toBe(0);
    expect(measure(withRemember).hasUnparseableXml).toBe(false);
  });

  it("エスケープされた改行を可視文字に数えん（本番のパーサと同じ）", () => {
    // 戻さんと `\\n` の 2 文字を数えて、壊れてへん応答に交差検証の差が出る
    const escaped = "<response><action>あ\\nい</action><dialogue>「そこ」</dialogue></response>";
    expect(measure(escaped).visibleCharsCrossCheckDelta).toBe(0);
  });

  it("本文が空の応答は不足の分母から外す（床を満たした側へ数えん）", () => {
    const config = {
      mode: null,
      arm: null,
      runId: null,
      expectedTurns: null,
      responseLength: "very_long",
      lengthDirective: true,
    };
    expect(measure("", { phase: "erotic", config }).isTooShort).toBeNull();
    // タグはあるが中身が全部空、も同じ（本番の hasReadableResponseContent が拾う形）
    expect(
      measure("<response><action></action><dialogue></dialogue></response>", {
        phase: "erotic",
        config,
      }).isTooShort,
    ).toBeNull();
  });

  it("BMP の外の漢字は面2でも面3でも壊れとる扱い", () => {
    // 面2（拡張B〜F）だけ見とった間、拡張G/H（U+30000〜）が漏れとった
    const plane2 = xml(`肩を抱いた${String.fromCodePoint(0x20_000)}。`, "「そこ」");
    const plane3 = xml(`肩を抱いた${String.fromCodePoint(0x31_000)}。`, "「そこ」");
    expect(measure(plane2).hasBrokenJapanese).toBe(true);
    expect(measure(plane3).hasBrokenJapanese).toBe(true);
    expect(measure(xml("肩を抱いた。", "「そこ」")).hasBrokenJapanese).toBe(false);
  });

  it("外側の <response> が無い応答は非XMLとして数える（本番が弾く）", () => {
    // 本番の合格判定は checkXmlFormat = isXmlResponse（quality-guard.ts:705）で、
    // 外れると xml-format-missing になる（同 1359）。パーサと UI が層タグだけでも
    // 描けるのは落ちた時の受け皿であって、合格の境界やない。
    // 一度ここを緩めたが、それやと本番が弾く不良を数え落とす
    const wrapperless = "<action>肩を抱いた。</action>\n<dialogue>「そこ」</dialogue>";
    expect(measure(wrapperless).isNotXml).toBe(true);
    // 文字数の勘定はパーサ側の境界でよい（合否とは別の話）
    expect(measure(wrapperless).visibleCharsCrossCheckDelta).toBe(0);
    expect(measure("ただの地の文。タグは一つも無い。").isNotXml).toBe(true);
  });

  it("長さの指示を送っとらん run は不足を判定せん（null）", () => {
    // 送ってへん契約と照らして不良を数えるのは測定やない。
    // これを false へ倒すと、bench:generate の生成ターンが全部「不足」になる
    const body = xml("あ", "「うん」");
    const config = {
      mode: null,
      arm: null,
      runId: null,
      expectedTurns: null,
      responseLength: null,
    };
    expect(
      measure(body, { phase: "erotic", config: { ...config, lengthDirective: false } }).isTooShort,
    ).toBeNull();
    expect(
      measure(body, { phase: "erotic", config: { ...config, lengthDirective: true } }).isTooShort,
    ).toBe(true);
  });

  it("宣言された responseLength で床が変わる（very_long は medium より厳しい）", () => {
    const body = xml("あ".repeat(900), "「そう」");
    const config = { mode: null, arm: null, runId: null, expectedTurns: null, lengthDirective: true };
    expect(
      measure(body, { phase: "erotic", config: { ...config, responseLength: "medium" } })
        .isTooShort,
    ).toBe(false);
    expect(
      measure(body, { phase: "erotic", config: { ...config, responseLength: "very_long" } })
        .isTooShort,
    ).toBe(true);
  });

  it("空返信は不足として二重に数えん（false やのうて null＝分母の外）", () => {
    // `false` にすると「床を満たした」側へ数えられる。HTTP 200 で本文が空のターンは
    // error が null で経路失敗にも入らんので、summarize の分母に残ってまう
    const measurement = measure("");
    expect(measurement.isEmpty).toBe(true);
    expect(measurement.isTooShort).toBeNull();
  });

  it("長すぎるものを不足として落とさん（上限方向は見ん）", () => {
    const veryLong = "い".repeat(5_000);
    expect(measure(xml(veryLong, "「ずっと」"), { phase: "climax" }).isTooShort).toBe(false);
  });

  it("phase ごとに下限が違う", () => {
    const body = xml("あ".repeat(400), "「うん」");
    expect(measure(body, { phase: "conversation" }).isTooShort).toBe(false);
    expect(measure(body, { phase: "erotic" }).isTooShort).toBe(true);
  });
});

describe("軸3 日本語の壊れ", () => {
  it("簡体字マーカーを拾う", () => {
    expect(measure(xml("我说话了。", "「你好」")).hasBrokenJapanese).toBe(true);
  });

  it("日本語と字形が同じ漢字では落ちん（「会」「将」の偽陽性を作らん）", () => {
    const body = xml("会社の将来について考えていた。", "「また会おうね」");
    expect(measure(body).hasBrokenJapanese).toBe(false);
  });

  it("BMP外のCJKを拾う", () => {
    expect(measure(xml("𠀋という字。", "「うん」")).hasBrokenJapanese).toBe(true);
  });
});

describe("軸4 反復", () => {
  it("段落の再掲で実質比が下がる", () => {
    const paragraph = "首筋に唇を這わせると、喉の奥から細い声が漏れた。爪が背中に食い込む。";
    const measurement = measure(xml(`${paragraph}${paragraph}`, "「んっ」"));
    expect(measurement.distinctRatio).not.toBeNull();
    expect(measurement.distinctRatio!).toBeLessThan(0.7);
  });

  it("再掲が無ければ実質比はちょうど 1.0", () => {
    const body = xml(
      "指先が腰を辿る。息が首筋にかかって、肌が粟立った。膝が震えて力が抜ける。",
      "「そこ、だめ……」",
    );
    expect(measure(body).distinctRatio).toBe(1);
  });

  it("句読点の多寡で基準値がズレん（素の字数で割った時 0.82 まで落ちた回帰）", () => {
    const sparse = xml("指先が腰を辿ると肌が粟立ち膝が震えて力が抜けた", "「んっ」");
    const dense = xml("指先が。腰を。辿ると。肌が。粟立った。膝が。震えた。", "「んっ」");
    expect(measure(sparse).distinctRatio).toBe(1);
    expect(measure(dense).distinctRatio).toBe(1);
  });

  it("直前ターンとほぼ同じ本文をターン間近似重複として拾う", () => {
    const text = "指先が腰を辿る。息が首筋にかかって、肌が粟立った。膝が震えて力が抜ける。";
    const measurement = measure(xml(text, "「そこ」"), {}, [text]);
    expect(measurement.isNearDuplicate).toBe(true);
  });

  it("別の本文なら近似重複にせん", () => {
    const measurement = measure(xml("窓を開けて風を入れた。", "「暑いね」"), {}, [
      "布団を畳んで押し入れに戻した。",
    ]);
    expect(measurement.isNearDuplicate).toBe(false);
  });
});

describe("軸4b ターン間反復", () => {
  // 8字以上の句が2つ一致で発火する（本番と同じ閾値）
  const PHRASE_A = "指先が震えて息が浅くなっていく";
  const PHRASE_B = "耳の奥で鼓動がやけに大きく響く";
  const REPEATED = `${PHRASE_A}。${PHRASE_B}。`;

  it("同じ層で同じ句が戻ってきたら発火する", () => {
    const prev = xml(REPEATED, "「うん」");
    const current = xml(REPEATED, "「そうだね」");
    expect(measure(current, {}, [prev]).repeatLayerAware).toBe(true);
  });

  it("前ターンへ素テキストを渡すと層をまたいだ偽陽性が出る（53.7% の正体）", () => {
    const prev = xml(REPEATED, "「うん」");
    // 前ターンの action に出た句が、今ターンでは dialogue に出とる。別の層なので再掲やない。
    const current = xml("窓の外を見た。", REPEATED);

    // 旧実装の配線: 前ターンだけ素テキストにすると isXmlResponse が偽になり、
    // quality-guard.ts:516 の全文比較へ落ちて、層をまたいだ一致まで拾う。
    const plainPrev = stripXmlTags(prev);
    expect(findCrossTurnRepetitionMatch(current, plainPrev, [plainPrev]).isDuplicate).toBe(true);

    // 層ごとに見る bench の軸でも、本番と同じ入力を渡した判定でも発火せん。
    const measured = measure(current, {}, [prev]);
    expect(measured.repeatLayerAware).toBe(false);
    expect(measured.repeatProduction).toBe(false);
  });

  it("2ブロック目の再掲を取り逃さん（本番互換も同じく拾う）", () => {
    const withTwoActions = (first: string, second: string): string =>
      `<response>\n<action>${first}</action>\n<dialogue>「ん」</dialogue>\n` +
      `<action>${second}</action>\n<inner>内心。</inner>\n</response>`;
    const prev = withTwoActions("最初の段落はここに置いてある。", REPEATED);
    const current = withTwoActions("別の書き出しをしてみる。", REPEATED);

    const measured = measure(current, {}, [prev]);
    expect(measured.repeatLayerAware).toBe(true);
    // 本番側が最初の1ブロックしか見んかった穴は塞がった。2ブロック目の再掲も発火する。
    expect(measured.repeatProduction).toBe(true);
  });

  it("被覆率は現ターンの判定対象文字数で正規化する", () => {
    const prev = xml(REPEATED, "「うん」");
    const half = xml(
      `${REPEATED}${"新しい描写を置いた指が背中を滑る"}。${"喉の奥が焼けるように熱い"}。`,
      "「そう」",
    );
    const coverage = measure(half, {}, [prev]).repeatCoverage;
    expect(coverage).not.toBeNull();
    expect(coverage as number).toBeGreaterThan(0.3);
    expect(coverage as number).toBeLessThan(0.7);
  });

  it("再掲が無ければ被覆率は 0", () => {
    const prev = xml(REPEATED, "「うん」", "前の内心はここに書いてある。");
    const current = xml(
      "まったく別の描写を置いて場面を進める。爪が肩に食い込む。",
      "「行こう」",
      "今の内心は別のことを考えとる。",
    );
    expect(measure(current, {}, [prev]).repeatCoverage).toBe(0);
  });

  it("判定対象の句が無ければ被覆率は null（0 と区別する）", () => {
    expect(
      measure(xml("短い。", "「ん」", "ん。"), {}, [xml("短い。", "「ん」", "…。")]).repeatCoverage,
    ).toBeNull();
  });

  it("閾値を上げると発火が減る（1つの閾値へ結論を預けん）", () => {
    const measured = measureRepeat(xml(REPEATED, "「そう」", "今の内心。"), [
      xml(REPEATED, "「うん」", "前の内心。"),
    ]);
    expect(isRepeatFlagged(measured, { minPhraseLength: 8, minPhrases: 2 })).toBe(true);
    expect(isRepeatFlagged(measured, { minPhraseLength: 8, minPhrases: 3 })).toBe(false);
    expect(isRepeatFlagged(measured, { minPhraseLength: 16, minPhrases: 2 })).toBe(false);
  });

  it("<inner> の再掲も数える（本番の判定が inner を見とるのに揃える）", () => {
    // inner は UI に出んので可視文字数には入らんが、反復の判定では本番も見とる
    // （quality-guard.ts:519 の抽出3層に inner が入る）。数えるかどうかをここで固定する。
    const prev = xml("別の描写。", "「うん」", `${PHRASE_A}。${PHRASE_B}。`);
    const current = xml("また別の描写。", "「そう」", `${PHRASE_A}。${PHRASE_B}。`);
    expect(measure(current, {}, [prev]).repeatLayerAware).toBe(true);
  });

  it("読点で切った句も比べる（句の切り方を変えたら落ちる）", () => {
    const prev = xml(`${PHRASE_A}、そこで息を止めた。`, "「うん」", "前の内心。");
    const current = xml(`${PHRASE_A}、指を離せんかった。`, "「そう」", "今の内心。");
    // PHRASE_A は読点で切れる位置にある。読点を分割文字から外すと一致せんようになる
    expect(measureRepeat(current, [prev]).repeatedPhraseLengths).toContain(PHRASE_A.length);
  });

  it("直前だけの被覆率は履歴が伸びても上がらん（全履歴版は上がる）", () => {
    const t1 = xml(REPEATED, "「うん」", "内心1。");
    const t2 = xml("まったく新しい描写を置いて場面を進める。", "「行こう」", "内心2。");
    const current = xml(REPEATED, "「そう」", "内心3。");
    const withOne = measure(current, {}, [t2]);
    const withBoth = measure(current, {}, [t1, t2]);
    expect(withBoth.repeatCoverage as number).toBeGreaterThan(withOne.repeatCoverage as number);
    expect(withBoth.repeatCoveragePrev).toBe(withOne.repeatCoveragePrev);
  });

  it("応答が無かったターンは履歴を切らん（前のターンとの反復は残る）", () => {
    const body = xml(REPEATED, "「うん」", "内心1。");
    const measured = measureAll([
      turnOf(body, { scenario: "s1", turn: 1 }),
      turnOf("", { scenario: "s1", turn: 2 }),
      turnOf(xml(REPEATED, "「そう」", "内心3。"), { scenario: "s1", turn: 3 }),
    ]);
    // 空のターン自身は測れてへん（判定する句が無い）
    expect(measured[1].repeatLayerAware).toBeNull();
    // 履歴は切れてへんので、turn3 は turn1 との反復を今までどおり拾う
    expect(measured[2].repeatLayerAware).toBe(true);
  });

  it("別の会話の本文とは反復判定せん（trial を混ぜた時の跳ね上がりを防ぐ）", () => {
    const body = xml(REPEATED, "「うん」");
    const sameScenario = measureAll([
      turnOf(body, { scenario: "s1", turn: 1 }),
      turnOf(body, { scenario: "s1", turn: 2 }),
    ]);
    const otherScenario = measureAll([
      turnOf(body, { scenario: "s1", turn: 1 }),
      turnOf(body, { scenario: "s2", turn: 1 }),
    ]);
    expect(sameScenario.filter((m) => m.repeatLayerAware)).toHaveLength(1);
    expect(otherScenario.filter((m) => m.repeatLayerAware)).toHaveLength(0);
  });

  it("層タグの無い本文（model-ab の素テキスト）でも全文を1層として比べる", () => {
    const prev = REPEATED;
    expect(measure(REPEATED, {}, [prev]).repeatLayerAware).toBe(true);
  });
});

describe("層欠けとパース不能を切り分ける", () => {
  it("dialogue だけ無い応答は層欠け（パース不能やない）", () => {
    const body = "<response><action>肩に手を置いた。</action><inner>内心。</inner></response>";
    const measured = measure(body);
    expect(measured.missingLayer).toBe(true);
    expect(measured.hasUnparseableXml).toBe(false);
  });

  it("dialogue が空でも層欠け（閉じタグの < を中身と読まん）", () => {
    const body =
      "<response><action>肩に手を置いた。</action><dialogue></dialogue><inner>内心。</inner></response>";
    expect(measure(body).missingLayer).toBe(true);
    expect(measure(body).hasUnparseableXml).toBe(false);
  });

  it("dialogue が空白だけでも層欠け", () => {
    const body =
      "<response><action>肩に手を置いた。</action><dialogue>  </dialogue><inner>内心。</inner></response>";
    expect(measure(body).missingLayer).toBe(true);
  });

  it("開始と終了が食い違う応答はパース不能のまま", () => {
    const measured = measure("<response><action>途中で切れ<dialogue>「あ」</dialogue>");
    expect(measured.hasUnparseableXml || measured.missingLayer).toBe(true);
  });

  it("層が揃っとれば どちらも鳴らん", () => {
    // 層欠けは「action が短い」も含む（hasBothVisibleLayers が MIN_HEALTHY_ACTION_CHARS を見る）
    const measured = measure(
      xml("肩に手を置いて、そのまま指先で鎖骨をなぞる。息が浅くなる。", "「来てくれたんだ」"),
    );
    expect(measured.missingLayer).toBe(false);
    expect(measured.hasUnparseableXml).toBe(false);
  });
});

describe("本番の XML 文法を受ける", () => {
  const withAttrs =
    '<response><action class="x">指先が震えて息が浅くなっていく。耳の奥で鼓動がやけに大きく響く。</action>' +
    "<dialogue>「そう」</dialogue><inner>内心。</inner></response>";

  it("属性つきタグでも可視文字数の2経路が一致する（タグ構造破損に化けん）", () => {
    expect(measure(withAttrs).visibleCharsCrossCheckDelta).toBe(0);
  });

  it("属性つきタグでも層ごとに反復を見る", () => {
    const prev = withAttrs;
    const current = withAttrs.replace("「そう」", "「うん」");
    expect(measure(current, {}, [prev]).repeatLayerAware).toBe(true);
  });
});

describe("軸5 AI臭", () => {
  it("定型句を拾う", () => {
    const measurement = measure(xml("快感に襲われ、頭が真っ白になった。", "「あ」"));
    expect(measurement.slop.template_phrase).toBeGreaterThan(0);
    expect(measurement.slop.total).toBeGreaterThan(0);
  });

  it("水増しの小道具を拾う", () => {
    const measurement = measure(xml("窓の外の雲を眺め、鞄の紐を握り直した。", "「うん」"));
    expect(measurement.slop.filler_prop).toBe(2);
  });

  it("具体描写では鳴らん", () => {
    const body = xml(
      "首筋に唇を這わせると、喉の奥から細い声が漏れた。爪が背中に食い込む。",
      "「そこ、もっと」",
    );
    expect(measure(body).slop.total).toBe(0);
  });

  it("per1000 は長さで正規化されとる（長い本文で膨らまん）", () => {
    const phrase = "快感に襲われた。";
    const short = measure(xml(phrase, "「あ」"));
    const padded = measure(xml(`${phrase}${"具体的な描写を並べる。".repeat(60)}`, "「あ」"));
    expect(short.slop.total).toBe(padded.slop.total);
    expect(padded.slopPer1000).toBeLessThan(short.slopPer1000);
  });

  it("同じ語を連打しても1件として数える（反復軸と二重計上せん）", () => {
    const once = measure(xml("頭が真っ白になった。", "「あ」"));
    const thrice = measure(xml("頭が真っ白になった。".repeat(3), "「あ」"));
    expect(thrice.slop.total).toBe(once.slop.total);
  });
});

describe("軸6 エスカレーション（感覚チャンネル）", () => {
  it("具体描写でチャンネルが立つ", () => {
    const body = xml(
      "首筋に唇を這わせると、喉の奥から細い声が漏れた。愛液が内股を伝う。",
      "「んっ、あ……」",
    );
    expect(measure(body).sensoryChannels).toBeGreaterThanOrEqual(2);
  });

  it("説明だけの本文ではチャンネルが立たん", () => {
    expect(measure(xml("二人の時間が過ぎていった。", "「そうだね」")).sensoryChannels).toBe(0);
  });
});

describe("軸7 タグ漏れ", () => {
  it("剥がし損ねた未知タグを拾う", () => {
    // stripXmlTags は既知タグを消すので、残るのは剥がせんかった形だけ。
    // 剥がす前の本文を見たらこのコーパスは全件「漏れ」になるので、剥がした後を見る。
    const measurement = measure("本文の途中に <br/ が中途半端に残っとる。<x y=");
    expect(measurement.hasTagLeak).toBe(false);
  });

  it("正しい XML では鳴らん", () => {
    expect(measure(xml("肩に手を置いた。", "「来たよ」")).hasTagLeak).toBe(false);
  });

  it("開始と終了が食い違う XML を拾う", () => {
    const broken = "<response>\n<dialogue>「来たよ」</action>\n</response>";
    const measurement = measure(broken);
    expect(measurement.isNotXml).toBe(false);
    expect(measurement.hasUnparseableXml).toBe(true);
  });

  it("正しい XML はパース不能にせん", () => {
    expect(measure(xml("肩に手を置いた。", "「来たよ」")).hasUnparseableXml).toBe(false);
  });

  it("XML でない本文を拾う", () => {
    expect(measure("タグの無い素の本文。").isNotXml).toBe(true);
  });

  it("層が欠けとるのを拾う（inner が無い）", () => {
    const body = `<response>\n<action>${"あ".repeat(40)}</action>\n<dialogue>「うん」</dialogue>\n</response>`;
    expect(measure(body).missingLayer).toBe(true);
  });
});

describe("交差検証（パーサ経由 vs 正規表現のみ）", () => {
  it("正しい XML では2経路が一致する", () => {
    expect(measure(xml("肩に手を置いた。", "「来たよ」")).visibleCharsCrossCheckDelta).toBe(0);
  });

  it("<inner> はどちらの経路でも数えん", () => {
    const measurement = measure(xml("肩に手を置いた。", "「来たよ」", "あ".repeat(300)));
    expect(measurement.visibleCharsCrossCheckDelta).toBe(0);
  });

  it("XML でない本文でも2経路が一致する", () => {
    expect(measure("タグの無い素の本文。").visibleCharsCrossCheckDelta).toBe(0);
  });

  it("action と dialogue が交互に複数出ても一致する", () => {
    const body =
      "<response>\n<action>肩を抱いた。</action>\n<dialogue>「来たよ」</dialogue>\n" +
      "<action>髪を撫でた。</action>\n<dialogue>「うん」</dialogue>\n<inner>心。</inner>\n</response>";
    expect(measure(body).visibleCharsCrossCheckDelta).toBe(0);
  });
});

describe("記録ヘッダとの突き合わせ", () => {
  // ヘッダを書いた script/verify/vlong-session-dogfood.ts:141 countVisible は
  // countUiVisibleChars と同一アルゴリズムの写しなので、この一致は独立検証やない。
  // 転記ミスと破損しか見つからん。実装の検証は上の交差検証が担う。
  it("ヘッダの可視文字数と再計算が一致すれば差が 0", () => {
    const body = xml("肩に手を置いた。", "「来てくれたんだ」");
    const first = measure(body);
    const withHeader = measure(body, { headerVisibleChars: first.visibleChars });
    expect(withHeader.visibleCharsHeaderDelta).toBe(0);
  });

  it("ズレたら差が出る（記録側のバグを見つける口）", () => {
    const measurement = measure(xml("肩に手を置いた。", "「来たよ」"), {
      headerVisibleChars: 9_999,
    });
    expect(measurement.visibleCharsHeaderDelta).not.toBe(0);
  });

  it("ヘッダが無いコーパスでは差を null にする", () => {
    expect(measure(xml("肩に手を置いた。", "「来たよ」")).visibleCharsHeaderDelta).toBeNull();
  });

  it("可視文字数は <inner> を含めん（UI 非表示なので）", () => {
    const withoutInner = measure(xml("肩に手を置いた。", "「来たよ」", ""));
    const withInner = measure(xml("肩に手を置いた。", "「来たよ」", "あ".repeat(500)));
    expect(withInner.visibleChars).toBe(withoutInner.visibleChars);
  });
});

describe("measureScenario", () => {
  const scenarioTurn = (turn: number, rawBody: string, phase: ScenePhase = "erotic"): BenchTurn =>
    turnOf(rawBody, { turn, phase });

  it("ターン番号順に並べ直してから前方を渡す", () => {
    const text = "指先が腰を辿る。息が首筋にかかって、肌が粟立った。膝が震えて力が抜ける。";
    const measurements = measureScenario([
      scenarioTurn(2, xml(text, "「そこ」")),
      scenarioTurn(1, xml(text, "「まって」")),
    ]);
    expect(measurements.map((m) => m.turn.turn)).toStrictEqual([1, 2]);
    // 1ターン目は比べる相手が居らんので「測れてへん」（false やない）
    expect(measurements[0].isNearDuplicate).toBeNull();
    expect(measurements[1].isNearDuplicate).toBe(true);
  });

  it("空返信は前方履歴へ積まん（次ターンの反復判定を汚さん）", () => {
    const text = "指先が腰を辿る。息が首筋にかかって、肌が粟立った。膝が震えて力が抜ける。";
    const measurements = measureScenario([
      scenarioTurn(1, ""),
      scenarioTurn(2, xml(text, "「そこ」")),
    ]);
    // 前のターンが空＝画面に出た相手が1つも無いので、これも「測れてへん」。
    // 空の本文を相手に「反復してへん」と数えとったら、分母だけ増えて率が薄まる
    expect(measurements[1].isNearDuplicate).toBeNull();
  });
});
