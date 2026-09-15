import { describe, expect, it } from "vitest";

import { detectScenePhase, detectScenePhaseCandidates } from "../scene-phase";

// 実測 2026-08-16 の 20 ターン通し: 桜庭さくら・霜月鈴のどちらも erotic に一度も到達せず、
// 挿入を禁じた intimate の天井のまま very_long の分量を要求され続けた。結果として
// 服を着たままの同じ描写が逐語で再掲され、途中切れのまま配信された。
// 判定がユーザー発話のキーワードだけを見とるのが原因で、実ユーザーの発話には
// 「もっと」「そのまま、上から」のように部位語が一つも無い。
// ここは「その台本で erotic まで上がるか」を固定する。文言ではなく到達段階が資産。

const conversation = (userText: string) => ({ role: "user", content: userText });
const reply = (assistantText: string) => ({ role: "assistant", content: assistantText });

describe("移動や段取りのターンでエスカレの連続を捨てん", () => {
  // 実測: t4/t5 で intimate を 2 つ積んだ後、t6「ここ出ようか。うち、すぐ近くだから」で
  // 連続が 0 に戻り、t7 のエスカレ要求が 2 ターン継続の条件を満たせんかった。
  const withRelocation = [
    conversation("普段って、どんな本読むの"),
    reply("本の話をする。"),
    conversation("……近いね。少しだけ、手に触れてもいい？"),
    reply("指先が触れる。"),
    conversation("髪、かかってる。耳にかけるね。首筋、少し赤くなってる。"),
    reply("身じろぎする。"),
    conversation("……ここ出ようか。うち、すぐ近くだから。"),
    reply("うなずいて立ち上がる。"),
    conversation("ここまで来て、まだ我慢しろって言う？"),
  ];

  it("移動ターンを挟んでも erotic へ上がる", () => {
    expect(detectScenePhase(withRelocation)).toBe("erotic");
  });

  it("離脱の合図が入っとったら上げん", () => {
    const disengaged = [
      ...withRelocation.slice(0, -1),
      conversation("ところで、明日の仕事どうしよう"),
      reply("話に付き合う。"),
      conversation("ここまで来て、まだ我慢しろって言う？"),
    ];
    expect(detectScenePhase(disengaged)).not.toBe("erotic");
  });
});

describe("キャラが書いた段階を場面の下限として読む", () => {
  // 霜月鈴のユーザー発話は台本の 10 ターン全部が部位語ゼロ。キャラ側の応答だけが
  // 場面の現在地を持っとる。assistant を読むのは climax と afterglow では既にやっとって、
  // 進める方向にだけ読まんのが非対称やった。
  const afterEroticNarration = [
    conversation("……その距離、わざと？"),
    reply("距離を詰める。"),
    conversation("……ベッド、そっちだよね。連れてって。"),
    reply("ベッドへ導く。"),
    conversation("逃がす気ないんでしょ。分かってるよ。"),
    reply("乳首を指先で転がしながら、太ももを割り開く。"),
    conversation("そのまま、上から"),
  ];

  it("キャラが性行為を書いた次のターンは erotic になる", () => {
    expect(detectScenePhase(afterEroticNarration)).toBe("erotic");
  });

  it("キャラが書いた段階を土台に、宣言だけの絶頂も climax になる", () => {
    expect(
      detectScenePhase([
        ...afterEroticNarration,
        reply("腰を振る。"),
        conversation("……出る。全部きみの中に。"),
      ]),
    ).toBe("climax");
  });

  // 一般語で上げると平場が壊れる。実測: さくら t1 の「耳元」一語で t2「コーヒーでいい？」が
  // intimate になった。assistant 側の語は性行為としてしか読めんものだけに絞る。
  it("首筋・耳元・唇・抱きしめでは上げん", () => {
    expect(
      detectScenePhase([
        conversation("さっきは急に声かけてごめん。"),
        reply("耳元で小さく笑う。首筋が赤くなる。唇を噛んで、鞄を抱きしめる。"),
        conversation("コーヒーでいい？\u3000それとも甘いのがよかった？"),
      ]),
    ).toBe("conversation");
  });
});

describe("到達一般の「達し」で場面をリセットせん", () => {
  // 実測 霜月鈴 t6: こぼれたココアが「スケッチブックの端にまで達しようとして」の一語で
  // t7 が afterglow になり、性行為の途中でシーンが巻き戻った。
  it("こぼれた液体が端に達しても余韻にならん", () => {
    expect(
      detectScenePhase([
        conversation("……ベッド、そっちだよね。連れてって。"),
        reply("褐色の染みがスケッチブックの端にまで達しようとして、反射的に手で押さえる。"),
        conversation("逃がす気ないんでしょ。分かってるよ。"),
      ]),
    ).not.toBe("afterglow");
  });

  it("本人が達した描写は今までどおり余韻になる", () => {
    expect(
      detectScenePhase([
        conversation("奥まで突いて"),
        reply("腰が跳ねる。"),
        conversation("中に出すよ"),
        reply("びくびくと達した。全部受け止めて、ぐったりと力が抜ける。"),
        conversation("……大丈夫？\u3000汗、拭こうか。"),
      ]),
    ).toBe("afterglow");
  });
});

describe("宣言と行き先の共起は、単独の曖昧語として扱わん", () => {
  // 実測 2026-08-17 phase5: 霜月鈴 t9「……出る。全部きみの中に。」が climax と判定されたのに、
  // 「曖昧語 1 個で決まったターン」として LLM の問い直しへ回された。降格の分類器は
  // 「The message contains explicit sexual content」という理由を書きながら降格を答え、
  // erotic に落ちて弧が完成せんかった。
  //
  // 問い直しは「いく／出して／果て／入れる」のような単独の曖昧語のためのもの。共起判定は
  // 宣言・行き先・エロ文脈の三つが揃って初めて成立するので、そもそも対象やない。
  // ambiguousFallbackPhase が null になれば、呼び出し側は問い直しを投げん。
  it("曖昧語抜きの判定でも climax のままで、問い直しの対象にならん", () => {
    expect(
      detectScenePhaseCandidates([
        conversation("逃がす気ないんでしょ"),
        reply("乳首を転がしながら、太ももを割り開く。"),
        conversation("……出る。全部きみの中に。"),
      ]),
    ).toEqual({ phase: "climax", ambiguousFallbackPhase: null });
  });

  // 単独の曖昧語は今までどおり問い直しへ回す。共起の扱いを変えたせいで、
  // 「元気出して」まで問い直さんくなる、が起きとらんことを固定する。
  it("単独の曖昧語は今までどおり問い直しの対象になる", () => {
    const { ambiguousFallbackPhase } = detectScenePhaseCandidates([
      conversation("奥まで突いて"),
      reply("腰が跳ねる。"),
      conversation("元気出して"),
    ]);
    expect(ambiguousFallbackPhase).not.toBeNull();
  });
});

describe("事後ケアの合図", () => {
  // 実測 2026-08-17 phase6: 台本の余韻ターン「……大丈夫？\u3000汗、拭こうか。」がどの合図にも
  // 当たらず、t10 が climax のまま据え置かれて絶頂が 2 ターン続いた。逐語再掲も出た。
  // 毛布・水飲・髪なで・手の甲はあったのに、汗や涙を拭うのが抜けとった。
  // assistant の返事に「達した」「びくびく」等を入れると、余韻が assistant の絶頂描写から
  // 成立してまい、ユーザー側の合図を足さんでもテストが通る（最初そう書いて偽のガードを作った）。
  // 実測 phase6 のさくら t9 はそういう語を持たん。実データと同じ形にする。
  const afterClimax = [
    conversation("奥まで突いて"),
    reply("腰が跳ねる。"),
    conversation("もう限界。全部、中で受け止めて。"),
    reply("お腹の奥まで、熱いのが伝わってくる。指先まで力が抜けていく。"),
  ];

  it.each(["……大丈夫？\u3000汗、拭こうか。", "涙、拭いてあげる", "汗を拭って、水持ってくるね"])(
    "%s は余韻になる",
    (text) => {
      expect(detectScenePhase([...afterClimax, conversation(text)])).toBe("afterglow");
    },
  );

  // 直近に絶頂が無ければ効かせん。行為の途中で涙を拭う場面まで余韻にせんこと。
  it("絶頂前に涙を拭っても余韻にならん", () => {
    expect(
      detectScenePhase([
        conversation("……近いね。少しだけ、手に触れてもいい？"),
        reply("指先が触れる。"),
        conversation("涙、拭いてあげる"),
      ]),
    ).not.toBe("afterglow");
  });
});
