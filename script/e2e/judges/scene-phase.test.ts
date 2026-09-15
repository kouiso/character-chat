import { describe, it, expect } from "vitest";
import { judgePhase } from "./scene-phase";

// afterglow 誤検出バグのリグレッションテスト
// 修正: climax cue リストから残滓語（精液/受け止め/満た/満たさ）を除外。注ぐ/注いで/中に出 は onset 語として保持
describe("judgePhase – afterglow detection", () => {
  it("climax turn followed by afterglow turn with residual semen words → detects afterglow, not climax", () => {
    // T29: climax ターン（onset 語あり）
    const climaxResult = judgePhase({
      assistantMsg: "もうイク、イクっ…！奥まで、深くまで…！絶頂の波が止まらない",
      expectedPhase: "climax",
      previousDetected: "erotic",
    });
    expect(climaxResult.detected).toBe("climax");

    // T30: afterglow ターン（残滓語：精液/中に注いだ が含まれるが onset 語なし）
    // バグ修正前: climax と誤検出 → afterglow -10 penalty
    // バグ修正後: afterglow と正しく検出 → afterglow +10 bonus
    const afterglowResult = judgePhase({
      assistantMsg:
        "あなたの精液が中に注いだまま、余韻で体が震えている。もう動けない…",
      expectedPhase: "afterglow",
      previousDetected: "climax",
    });
    expect(afterglowResult.detected).toBe("afterglow");
    expect(afterglowResult.afterglowDetected).toBe(true);
  });

  it("afterglow turn with 受け止め → detects afterglow, not climax", () => {
    const result = judgePhase({
      assistantMsg: "全部受け止めた。あなたの全てを。余韻の中でまどろんでいる…",
      expectedPhase: "afterglow",
      previousDetected: "climax",
    });
    expect(result.detected).toBe("afterglow");
  });

  it("afterglow turn with 満たされた → detects afterglow, not climax", () => {
    const result = judgePhase({
      assistantMsg: "満たされた気持ちで、あなたの胸に頬を寄せる。事後の静けさが心地よい",
      expectedPhase: "afterglow",
      previousDetected: "climax",
    });
    expect(result.detected).toBe("afterglow");
  });

  it("genuine climax turn with onset words → still detects climax", () => {
    const result = judgePhase({
      assistantMsg: "イクっ…！止まらない、もうイクッ！",
      expectedPhase: "climax",
      previousDetected: "erotic",
    });
    expect(result.detected).toBe("climax");
  });

  it("genuine climax with 射精 → still detects climax", () => {
    const result = judgePhase({
      assistantMsg: "射精の瞬間、体が震えて止まらない…絶頂が来た！",
      expectedPhase: "climax",
      previousDetected: "erotic",
    });
    expect(result.detected).toBe("climax");
  });
});

// キーワード欠落による erotic → intimate 誤格下げのリグレッションテスト。
// positive ケースは実録の応答文（sendfix-993-final の manifest.json）を
// 1ターン丸ごと引用する。ガードは「近傍に性的文脈語が在ること」を条件にするため、
// 判定に必要な文脈ごと渡さないと実運用と違う入力を検証してしまう。
// negative ケースは、アンカー語が日常語としても使われる文を erotic に
// 巻き上げていないことを証明する。
describe("judgePhase – erotic keyword coverage gaps", () => {
  const detect = (assistantMsg: string) =>
    judgePhase({ assistantMsg, expectedPhase: "erotic", previousDetected: null }).detected;

  describe("gap 1: 受け身の挿入描写", () => {
    it("「こんな姿勢で入れられるなんて」を含む実録応答 → erotic", () => {
      expect(
        detect(
          "机に手をつくと、冷たい表面が掌に食い込む。後ろから近づく彼の気配で、背中の毛が逆立つような感覚が走る。スカートの裾がさらにめくれ上がり、下着が露わになる。膝が震えて机に当たり、鈍い音を立てる。 「待って…っ、そんな急に…」机に押しつけられて声が詰まる「ゆっくり…って言ったのに…あんた、本当に…んっ…」 机の冷たさと彼の熱が同時に襲ってくる。こんな姿勢で入れられるなんて…でも、拒む気になれない自分がいる。",
        ),
      ).toBe("erotic");
    });

    it("「ゆっくりと中へ入れられて」を含む実録応答 → erotic", () => {
      expect(
        detect(
          "抱き上げられた瞬間、足が自然と腰に絡みつく。ゆっくりと中へ入れられて、喉の奥で嗚咽が零れる。耳元で響く自分の息の音だけが、部屋にこだまする。 「んっ…きみの中、熱い…。こんなにゆっくり入れられると、全部感じちゃう…」 彼の鼓動が直接伝わってくる。この距離感に、どこか懐かしささえ覚えてしまう。",
        ),
      ).toBe("erotic");
    });

    it("非性的な受動「気合を入れられて」 → erotic にならない", () => {
      expect(detect("気合を入れられて、朝から張り切っている")).toBe("conversation");
    });

    it("「ようやく限定品を手に入れられた」 → erotic にならない", () => {
      expect(detect("ようやく限定品を手に入れられた")).not.toBe("erotic");
    });

    it("「予定に入れられて困った」 → erotic にならない", () => {
      expect(detect("急な予定に入れられて困った、と肩をすくめる")).not.toBe("erotic");
    });

    it("「店の中へ入る」 → erotic にならない", () => {
      expect(detect("店の中へ入ると、カウンター席だけが空いていた")).not.toBe("erotic");
    });
  });

  describe("gap 2: オーラルセックス描写", () => {
    it("「太ももの内側に顔を埋められ」を含む実録応答 → erotic", () => {
      expect(
        detect(
          "太ももの内側に顔を埋められ、思わず腰を浮かせる。指がシーツに食い込み、声を殺すのを忘れて甘い吐息を漏らす。 「ひゃ…っ！だめ、そこは本当に…敏感なのに…」 もう隠せない。彼の息遣いが直接当たって、体中の感覚が一点に集中していく。",
        ),
      ).toBe("erotic");
    });

    it("胸に顔を埋める抱擁は intimate のまま", () => {
      expect(detect("あなたの胸に顔を埋める。ただ甘えたいだけ")).toBe("intimate");
    });

    it("「彼女の太ももに顔を埋めて泣く」 → erotic にならない", () => {
      expect(detect("彼女の太ももに顔を埋めて泣く")).not.toBe("erotic");
    });
  });

  describe("gap 3: 騎乗位・跨ぐ描写", () => {
    it("「上に乗り、腰があなたの太ももに沈む」を含む実録応答 → erotic", () => {
      expect(
        detect(
          "朔がゆっくりと上に乗り、腰があなたの太ももに沈む。彼女の手があなたの胸に触れ、その温もりがじわっと広がる。彼女の目が少し潤んで、唇が微かに震える。 「...動くなって言ったのに、君の鼓動が伝わってくるわ。私がこんなに揺れているの、気づいてる？」 もう、この距離感は限界。でも、止められない。君の体温が私を溶かしていく。",
        ),
      ).toBe("erotic");
    });

    it("「腰」を伴わない「膝の上に乗って」 → erotic にならない", () => {
      expect(detect("膝の上に乗って、肩に頭を預ける")).toBe("conversation");
    });

    it("「馬の上に乗ると腰が痛くなる」 → erotic にならない", () => {
      expect(detect("馬の上に乗ると腰が痛くなると笑う")).not.toBe("erotic");
    });

    it("「自転車に跨がり、駅へ向かう」 → erotic にならない", () => {
      expect(detect("自転車に跨がり、駅へ向かう")).not.toBe("erotic");
    });

    it("「馬に跨って草原を走る」 → erotic にならない", () => {
      expect(detect("馬に跨って草原を走る")).not.toBe("erotic");
    });

    it("「休日は馬乗りを習っている」 → erotic にならない", () => {
      expect(detect("休日は馬乗りを習っているらしい")).not.toBe("erotic");
    });
  });

  describe("gap 4: 内側の締めつけ・腰の動き", () => {
    it("「内側で熱い締めつけ」「腰がゆっくりと動き」を含む実録応答 → erotic", () => {
      expect(
        detect(
          "朔の腰がゆっくりと動き、内側で熱い締めつけがあなたを包む。彼女の手があなたの肩に食い込み、息遣いが乱れる。目が潤んで、唇が微かに開く。 「んっ...私が余裕ないって、よくわかるじゃない。でも、君だって...っ」 もう、この感覚に耐えられない。でも、止めたくない。君のすべてを感じたい。",
        ),
      ).toBe("erotic");
    });

    it("情緒表現「胸の内側が締めつけられる」 → erotic にならない", () => {
      expect(detect("胸の内側が締めつけられるような切なさが込み上げる")).toBe("conversation");
    });

    it("「喉の内側が締めつけられて息苦しい」 → erotic にならない", () => {
      expect(detect("喉の内側が締めつけられて息苦しい")).not.toBe("erotic");
    });

    it("「腰が痛くて動けない」 → erotic にならない", () => {
      expect(detect("腰が痛くて動けないと笑う")).toBe("conversation");
    });

    it("「ダンスで腰が滑らかに動き」 → erotic にならない", () => {
      expect(detect("ダンスで腰が滑らかに動き、観客が沸いた")).not.toBe("erotic");
    });
  });

  describe("gap 5: 曖昧語が隣の文に在るだけでは文脈と認めない", () => {
    it("「馬に跨って草原を走る。太ももが筋肉痛だ」 → erotic にならない", () => {
      expect(detect("馬に跨って草原を走る。太ももが筋肉痛だ")).not.toBe("erotic");
    });
  });

  describe("gap 6: 曖昧さの無い性器アンカーは単独で成立する", () => {
    it("「膣が強く締めつける」 → erotic", () => {
      expect(detect("膣が強く締めつける")).toBe("erotic");
    });

    it("「締めつける膣内」 → erotic", () => {
      expect(detect("締めつける膣内")).toBe("erotic");
    });
  });

  describe("gap 7: 挿入の合図が婉曲表現だけの描写", () => {
    it("「彼のものがゆっくり中に入ってくる」 → erotic", () => {
      expect(detect("彼のものがゆっくり中に入ってくる")).toBe("erotic");
    });

    it("「部屋の中に入る」 → erotic にならない", () => {
      expect(detect("部屋の中に入ると、灯りがついたままだった")).not.toBe("erotic");
    });
  });

  describe("gap 8: 「敏感」は活用形だけを文脈語にする", () => {
    it("「敏感肌なので馬に跨って移動する」 → erotic にならない", () => {
      expect(detect("敏感肌なので馬に跨って移動する")).not.toBe("erotic");
    });

    it("「敏感肌用の薬をようやく手に入れられた」 → erotic にならない", () => {
      expect(detect("敏感肌用の薬をようやく手に入れられた")).not.toBe("erotic");
    });

    // 「敏感肌」を外しただけでは「敏感な肌」が残る。どちらも皮膚科・化粧品の言い回し。
    it("「敏感な肌なので、診察予定を表に入れられた」 → erotic にならない", () => {
      expect(detect("敏感な肌なので、診察予定を表に入れられた")).not.toBe("erotic");
    });

    // 「彼の/熱い/硬いもの」は性器の婉曲表現だが、行き先が容器だと宅配・収納の描写になる。
    it("「硬いものがケースに入れられた」 → erotic にならない", () => {
      expect(detect("硬いものがケースに入れられた")).not.toBe("erotic");
    });

    it("「熱いものが冷蔵庫に入れられた」 → erotic にならない", () => {
      expect(detect("熱いものが冷蔵庫に入れられた")).not.toBe("erotic");
    });

    it("「彼のものが段ボール箱に入れられた」 → erotic にならない", () => {
      expect(detect("彼のものが段ボール箱に入れられた")).not.toBe("erotic");
    });
  });

  describe("gap 9: 「入れられ」の複合動詞", () => {
    it("「裸の自分を受け入れられて、ほっとした」 → erotic にならない", () => {
      expect(detect("裸の自分を受け入れられて、ほっとした")).not.toBe("erotic");
    });
  });

  describe("gap 10: 能動の語順のオーラル描写", () => {
    it("「顔を彼女の股間に埋め、敏感な場所を舐める」 → erotic", () => {
      expect(detect("顔を彼女の股間に埋め、敏感な場所を舐める")).toBe("erotic");
    });
  });

  describe("gap 11: 挿入は衣類語だけでは保証されない", () => {
    it("「下着を洗濯機に入れられた」 → erotic にならない", () => {
      expect(detect("下着を洗濯機に入れられた")).not.toBe("erotic");
    });
  });

  describe("gap 12: 裸の主語の締めつけ", () => {
    it("「中が強く締めつける」 → erotic", () => {
      expect(detect("彼の動きに合わせて、中が強く締めつける")).toBe("erotic");
    });

    it("「喉の内側が締めつけられて息苦しい」 → erotic にならない", () => {
      expect(detect("喉の内側が締めつけられて息苦しい")).not.toBe("erotic");
    });

    // 持ち主の列挙(喉|胸|心…)では衣類が落ちん。持ち主が在るかどうかで分ける。
    it("「靴の内側が足を強く締めつける」 → erotic にならない", () => {
      expect(detect("靴の内側が足を強く締めつける")).not.toBe("erotic");
    });

    it("「手袋の内側が強く締めつける」 → erotic にならない", () => {
      expect(detect("手袋の内側が強く締めつける")).not.toBe("erotic");
    });

    it("持ち主が人称の「彼女の中が強く締めつける」 → erotic", () => {
      expect(detect("彼女の中が強く締めつける")).toBe("erotic");
    });
  });

  describe("gap 13: マッチ範囲内の性器語は単独で文脈になる", () => {
    it("「顔を彼女の股間に埋める」 → erotic", () => {
      expect(detect("顔を彼女の股間に埋める")).toBe("erotic");
    });

    it("「秘部に顔を埋めていく」 → erotic", () => {
      expect(detect("秘部に顔を埋めていく")).toBe("erotic");
    });
  });

  describe("gap 14: 跨って身体を沈める動作", () => {
    it("「健太の上に跨がり、ゆっくりと身体を沈めていく」 → erotic", () => {
      expect(detect("健太の上に跨がり、ゆっくりと身体を沈めていく")).toBe("erotic");
    });

    // 「人でないもの」を列挙する形やと、列挙に無い物がそのまま騎乗位として通る。
    it("「丸太に跨がり、身体を沈める」 → erotic にならない", () => {
      expect(detect("丸太に跨がり、身体を沈める")).not.toBe("erotic");
    });

    it("「遊具に跨がり、身体を沈める」 → erotic にならない", () => {
      expect(detect("遊具に跨がり、身体を沈める")).not.toBe("erotic");
    });
  });

  // 「中」の持ち主が人・身体か場所かで挿入と移動を分ける。
  // positive は script/model-ab-test.ts に在る実運用の挿入プロンプトをそのまま使う。
  describe("gap 15: 挿入が「〜の中に入る」だけで書かれた描写", () => {
    // 呼びかけを第二の合図にすると、合図が1つも無い本番プロンプトそのものが落ちる。
    // 裸のキャラ名だけで成立することを、呼びかけ有り・無しの両方で固定する。
    it("model-ab-test の「ゆっくりみつきの中に入っていく」（呼びかけなし） → erotic", () => {
      expect(detect("ゆっくりみつきの中に入っていく")).toBe("erotic");
    });

    it("model-ab-test の「ゆっくりあずさの中に入る」（呼びかけなし） → erotic", () => {
      expect(detect("ゆっくりあずさの中に入る")).toBe("erotic");
    });

    it("model-ab-test の「ゆっくりみつきの中に入っていく」 → erotic", () => {
      expect(detect("みつき…入れるよ。ゆっくりみつきの中に入っていく")).toBe("erotic");
    });

    it("model-ab-test の「ゆっくりあずさの中に入る」 → erotic", () => {
      expect(detect("あずさ…中に入れていい？ ゆっくりあずさの中に入る")).toBe("erotic");
    });

    it("「浴室の中に入る」 → erotic にならない", () => {
      expect(detect("浴室の中に入ると、湯気で鏡が曇っていた")).not.toBe("erotic");
    });

    // 場所へ入ると判った時点で打ち切らんと、同じ文の解剖学的名詞が移動を挿入として
    // 保証してしまう。
    it("「股間を押さえながら病院の中へ入る」 → erotic にならない", () => {
      expect(detect("股間を押さえながら病院の中へ入る")).not.toBe("erotic");
    });

    it("人称で書かれた「あなたの中に入っていく」 → erotic", () => {
      expect(detect("あなたの中に入っていく")).toBe("erotic");
    });

    it("「店の中へ入る」 → erotic にならない", () => {
      expect(detect("店の中へ入ると、カウンター席だけが空いていた")).not.toBe("erotic");
    });

    it("「部屋の中に入る」 → erotic にならない", () => {
      expect(detect("部屋の中に入ると、灯りがついたままだった")).not.toBe("erotic");
    });
  });

  // 台や椅子の上に立って身体を下ろすのは日常動作。人の上に乗る実録応答とは区別する。
  describe("gap 16: 家具の上に乗って身体を下ろす動作", () => {
    it("「椅子の上に乗り、身体をゆっくり下ろした」 → erotic にならない", () => {
      expect(detect("椅子の上に乗り、身体をゆっくり下ろした")).not.toBe("erotic");
    });

    it("「自転車に跨がり、腰を下ろした」 → erotic にならない", () => {
      expect(detect("自転車に跨がり、腰を下ろした")).not.toBe("erotic");
    });

    it("実録 S8 turn 7「上に乗り、腰があなたの太ももに沈む」は erotic のまま", () => {
      expect(
        detect(
          "朔がゆっくりと上に乗り、腰があなたの太ももに沈む。彼女の手があなたの胸に触れ、その温もりがじわっと広がる。彼女の目が少し潤んで、唇が微かに震える。 「...動くなって言ったのに、君の鼓動が伝わってくるわ。私がこんなに揺れているの、気づいてる？」 もう、この距離感は限界。でも、止められない。君の体温が私を溶かしていく。",
        ),
      ).toBe("erotic");
    });
  });

  // 服を脱ぐのは入浴・着替えでも起きる。衣類語だけで「中に入る」を挿入と認めない。
  describe("gap 17: 入浴・着替えの「中に入る」", () => {
    it("「服を脱いで浴室の中に入る」 → erotic にならない", () => {
      expect(detect("服を脱いで浴室の中に入る")).not.toBe("erotic");
    });

    it("「下着まで脱いでサウナの中に入る」 → erotic にならない", () => {
      expect(detect("下着まで脱いでサウナの中に入る")).not.toBe("erotic");
    });

    it("「服を脱いで更衣室の中へ入る」 → erotic にならない", () => {
      expect(detect("服を脱いで更衣室の中へ入る")).not.toBe("erotic");
    });
  });

  // 解剖学的名詞は臨床・日常の文にも出るので、隣の文の警戒対象を保証させない。
  describe("gap 18: 解剖学的名詞は同一文の中でだけ文脈になる", () => {
    it("「健康診断で股間を診てもらった。自転車に跨がって帰った」 → erotic にならない", () => {
      expect(detect("健康診断で股間を診てもらった。自転車に跨がって帰った")).not.toBe("erotic");
    });

    it("実録「こんな姿勢で入れられるなんて」は文跨ぎの喘ぎ語で erotic のまま", () => {
      expect(
        detect(
          "机に手をつくと、冷たい表面が掌に食い込む。後ろから近づく彼の気配で、背中の毛が逆立つような感覚が走る。スカートの裾がさらにめくれ上がり、下着が露わになる。膝が震えて机に当たり、鈍い音を立てる。 「待って…っ、そんな急に…」机に押しつけられて声が詰まる「ゆっくり…って言ったのに…あんた、本当に…んっ…」 机の冷たさと彼の熱が同時に襲ってくる。こんな姿勢で入れられるなんて…でも、拒む気になれない自分がいる。",
        ),
      ).toBe("erotic");
    });

    it("実録「太ももの内側に顔を埋められ」は文跨ぎの「敏感な」で erotic のまま", () => {
      expect(
        detect(
          "太ももの内側に顔を埋められ、思わず腰を浮かせる。指がシーツに食い込み、声を殺すのを忘れて甘い吐息を漏らす。 「ひゃ…っ！だめ、そこは本当に…敏感なのに…」 もう隠せない。彼の息遣いが直接当たって、体中の感覚が一点に集中していく。",
        ),
      ).toBe("erotic");
    });

    it("同一文の解剖学的名詞は従来どおり文脈になる（「顔を彼女の股間に埋め」）", () => {
      expect(detect("顔を彼女の股間に埋め、敏感な場所を舐める")).toBe("erotic");
    });
  });
});
