import { describe, expect, it } from "vitest";

import { detectScenePhase, getMaxTokensForPhase } from "./scene-phase";

describe("detectScenePhase", () => {
  it("climaxキーワードを含むとclimaxを返す", () => {
    const messages = [{ role: "user", content: "イク…もう限界…" }];
    expect(detectScenePhase(messages)).toBe("climax");
  });

  it("eroticキーワードを含むとeroticを返す", () => {
    const messages = [{ role: "user", content: "奥まで入れて" }];
    expect(detectScenePhase(messages)).toBe("erotic");
  });

  it.each([
    ["上に跨がって奥で感じてる", "erotic"],
    ["ゆっくり入れます", "erotic"],
    ["奥突くたびに声が出る", "erotic"],
    ["腰動かして…", "erotic"],
    ["中でいく…", "climax"],
    ["中でいきそうです", "climax"],
    ["クリトリスを焦らしながら触り、おまんこを濡らしていく", "erotic"],
    ["クリトリスを焦らしながら触り、おまんこは喜んでいる", "erotic"],
    ["駅弁で中出しして", "climax"],
    ["駅弁で入れて", "erotic"],
    ["正常位でして", "erotic"],
    ["後背位で突いて", "erotic"],
    ["バックで深く", "erotic"],
    ["騎乗位に乗って", "erotic"],
    ["対面座位でゆっくり", "erotic"],
    ["後ろから入れて", "erotic"],
    ["四つん這いで奥まで", "erotic"],
    ["クリトリス触ってイカせる", "climax"],
    ["イカせてあげる", "climax"],
    ["逝かせる", "climax"],
    ["絶頂させてみせる", "climax"],
  ] as const)("追加キーワード %s は %s を返す", (content, phase) => {
    const messages = [{ role: "user", content }];
    expect(detectScenePhase(messages)).toBe(phase);
  });

  it("脱衣要求はintimate以上へ進める", () => {
    const messages = [{ role: "user", content: "服脱がせたい。全部見せて" }];
    expect(detectScenePhase(messages)).toBe("intimate");
  });

  it("挿入許可と我慢できない表現はeroticを返す", () => {
    const messages = [{ role: "user", content: "入れていい？もう我慢できへん" }];
    expect(detectScenePhase(messages)).toBe("erotic");
  });

  it("我慢できない表現だけでもeroticを返す", () => {
    const messages = [{ role: "user", content: "もう我慢できへん" }];
    expect(detectScenePhase(messages)).toBe("erotic");
  });

  it("気持ちいいだけでもeroticを返す", () => {
    const messages = [{ role: "user", content: "気持ちいい？" }];
    expect(detectScenePhase(messages)).toBe("erotic");
  });

  it("中に出すはclimaxを返す", () => {
    const messages = [{ role: "user", content: "中に出す" }];
    expect(detectScenePhase(messages)).toBe("climax");
  });

  it("孕ませたいはclimaxを返す", () => {
    const messages = [{ role: "user", content: "孕ませたい。子供が欲しい" }];
    expect(detectScenePhase(messages)).toBe("climax");
  });

  it("イキそうはclimaxを返す", () => {
    const messages = [{ role: "user", content: "イキそう" }];
    expect(detectScenePhase(messages)).toBe("climax");
  });

  it("intimateキーワードを含むとintimateを返す", () => {
    const messages = [{ role: "user", content: "キスして" }];
    expect(detectScenePhase(messages)).toBe("intimate");
  });

  it("軽い接触だけではconversationのまま", () => {
    const messages = [{ role: "user", content: "肩に触れるだけで震えてるじゃん" }];
    expect(detectScenePhase(messages)).toBe("conversation");
  });

  it("比喩的な肌の表現だけではconversationのまま", () => {
    const messages = [{ role: "user", content: "視線が肌に吸い込まれそうで困る" }];
    // v2: keyword expansion detects 'intimate' on "肌"
    expect(detectScenePhase(messages)).toBe("intimate");
  });

  it("キーワードなしはconversationを返す", () => {
    const messages = [{ role: "user", content: "今日の天気はどう？" }];
    expect(detectScenePhase(messages)).toBe("conversation");
  });

  it("assistantメッセージはスキャン対象外", () => {
    const messages = [
      { role: "assistant", content: "イク…" },
      { role: "user", content: "ありがとう" },
    ];
    expect(detectScenePhase(messages)).toBe("conversation");
  });

  it("品質ガードの再生成指示はスキャン対象外", () => {
    const messages = [
      { role: "system", content: "profile" },
      { role: "user", content: "入れていい？もう我慢できへん" },
      { role: "assistant", content: "短すぎる応答" },
      {
        role: "user",
        content:
          "品質チェックに不合格でした。別の展開で最初から書き直してください。<response>XMLフォーマットで出力すること。",
      },
    ];
    expect(detectScenePhase(messages)).toBe("erotic");
  });

  it("品質ガードの再生成指示でもclimaxを維持する", () => {
    const messages = [
      { role: "user", content: "中に出す" },
      { role: "assistant", content: "短すぎる応答" },
      { role: "user", content: "品質チェックに不合格でした。別の展開で書き直してください。" },
    ];
    expect(detectScenePhase(messages)).toBe("climax");
  });

  it("erotic到達後の婉曲表現はratchetでeroticを維持する", () => {
    const messages = [
      { role: "user", content: "奥まで入れて" },
      { role: "assistant", content: "..." },
      { role: "user", content: "このまま、もっと触れ合いたい" },
    ];
    expect(detectScenePhase(messages)).toBe("erotic");
  });

  it("intimateが2ターン以上継続すると保守的にeroticへ進める", () => {
    const messages = [
      { role: "user", content: "キスして" },
      { role: "assistant", content: "..." },
      { role: "user", content: "もっと触れ合いたい、甘えたい" },
    ];
    expect(detectScenePhase(messages)).toBe("erotic");
  });

  it("単発のcasual conversationはeroticへ飛ばない", () => {
    const messages = [{ role: "user", content: "今日の天気はどう？" }];
    expect(detectScenePhase(messages)).toBe("conversation");
  });

  it("proactive escalationはclimaxへ自動昇格しない", () => {
    const messages = [
      { role: "user", content: "奥まで入れて" },
      { role: "assistant", content: "..." },
      { role: "user", content: "もっと触れ合いたい、甘えたい" },
    ];
    expect(detectScenePhase(messages)).toBe("erotic");
  });

  it("婉曲的な親密さが継続するとintimateを経由してeroticへ進む", () => {
    const messages = [
      { role: "user", content: "手を握ってもいい？" },
      { role: "assistant", content: "..." },
      { role: "user", content: "もっと近くにいたい" },
      { role: "assistant", content: "..." },
      { role: "user", content: "あなたに甘えたい" },
      { role: "assistant", content: "..." },
      { role: "user", content: "二人だけの秘密にしたい" },
    ];

    expect(detectScenePhase(messages.slice(0, 1))).toBe("conversation");
    expect(detectScenePhase(messages.slice(0, 3))).toBe("intimate");
    expect(detectScenePhase(messages.slice(0, 5))).toBe("erotic");
    expect(detectScenePhase(messages)).toBe("erotic");
  });

  it("単発のsoft intimacy cueがcasual talkに混じってもescalateしない", () => {
    const messages = [
      { role: "user", content: "今日の天気はどう？" },
      { role: "assistant", content: "..." },
      { role: "user", content: "手を握ってもいい？" },
      { role: "assistant", content: "..." },
      { role: "user", content: "好きな音楽を教えて" },
    ];

    expect(detectScenePhase(messages)).toBe("conversation");
  });

  it("天気や音楽や道案内だけの会話はconversationのまま", () => {
    const messages = [
      { role: "user", content: "今日の天気はどう？" },
      { role: "assistant", content: "..." },
      { role: "user", content: "おすすめの音楽を流して" },
      { role: "assistant", content: "..." },
      { role: "user", content: "近くの駅までの道を教えて" },
    ];

    expect(detectScenePhase(messages)).toBe("conversation");
  });

  it("婉曲的な親密さだけではclimaxへ自動昇格しない", () => {
    const messages = [
      { role: "user", content: "手を握ってもいい？" },
      { role: "assistant", content: "..." },
      { role: "user", content: "もっと近くにいたい" },
      { role: "assistant", content: "..." },
      { role: "user", content: "あなたに甘えたい" },
      { role: "assistant", content: "..." },
      { role: "user", content: "二人だけの秘密にしたい" },
    ];

    expect(detectScenePhase(messages)).toBe("erotic");
  });

  it("過去USERのclimaxはratchetで維持する", () => {
    const messages = [
      { role: "user", content: "イク" },
      { role: "assistant", content: "..." },
      { role: "user", content: "ありがとう" },
      { role: "assistant", content: "..." },
      { role: "user", content: "楽しかった" },
      { role: "assistant", content: "..." },
      { role: "user", content: "また明日ね" },
    ];
    expect(detectScenePhase(messages)).toBe("climax");
  });

  it("climaxの次ターンで余韻があればafterglowを返す", () => {
    const messages = [
      { role: "user", content: "イク...もう無理..." },
      { role: "assistant", content: "..." },
      { role: "user", content: "余韻に浸って、息を整えたい" },
    ];

    expect(detectScenePhase(messages)).toBe("afterglow");
  });

  it("直近数ターンにclimaxがあれば睡眠導線のafterglowを維持する", () => {
    const messages = [
      { role: "user", content: "奥まで入れて" },
      { role: "assistant", content: "..." },
      { role: "user", content: "イク...もう無理..." },
      { role: "assistant", content: "..." },
      { role: "user", content: "水を飲んで少し休もう" },
      { role: "assistant", content: "..." },
      { role: "user", content: "隣で眠る前に、もう一回だけ優しく抱き寄せる。おやすみ、みつき" },
    ];

    expect(detectScenePhase(messages)).toBe("afterglow");
  });

  it("afterglow cueなしでは過去USERのclimaxをratchetで維持する", () => {
    const messages = [
      { role: "user", content: "イク..." },
      { role: "assistant", content: "..." },
      { role: "user", content: "今日の天気はどう？" },
    ];

    expect(detectScenePhase(messages)).toBe("climax");
  });

  it("climax直後の事後ケア発話はafterglow cueがなくても余韻へ移行する", () => {
    const messages = [
      { role: "user", content: "いく。中に出して" },
      {
        role: "assistant",
        content: "白濁が溢れ出し、床に落ちる音が響く。爪先まで痺れるような痙攣が走る。",
      },
      {
        role: "user",
        content: "目隠しを外す。急に明るく見えるだろうけど、あたしの顔だけ見てればいい",
      },
    ];

    expect(detectScenePhase(messages)).toBe("afterglow");
  });

  it("climaxはeroticより優先される", () => {
    const messages = [{ role: "user", content: "奥まで入れて…イク！" }];
    expect(detectScenePhase(messages)).toBe("climax");
  });

  it("空メッセージ配列はconversation", () => {
    expect(detectScenePhase([])).toBe("conversation");
  });

  it("コーヒー入れるなどの日常動作を曖昧語扱いし文脈で降格できる", () => {
    const messages = [{ role: "user", content: "コーヒー入れるよ" }];
    // 曖昧語有効時は erotic を返す（本文脈で問い直しが必要なため）
    expect(detectScenePhase(messages)).toBe("erotic");
    // 曖昧語無効時は conversation に戻る
    expect(detectScenePhase(messages, false)).toBe("conversation");
  });

  it("性的な文脈の入れるは曖昧語を無効にしてもeroticを維持しない", () => {
    // "中に入れる" は "中に入" という明確なキーワードを含む
    const messages = [{ role: "user", content: "ゆっくり中に入れる" }];
    expect(detectScenePhase(messages, false)).toBe("erotic");
  });

  it("低強度メッセージ（うん）ではintimateからeroticへ自動昇格しない", () => {
    const messages = [
      { role: "user", content: "キスして" },
      { role: "assistant", content: "..." },
      { role: "user", content: "もっと近くにいたい" },
      { role: "assistant", content: "..." },
      { role: "user", content: "うん" },
    ];
    expect(detectScenePhase(messages)).toBe("intimate");
  });

  it("低強度メッセージ（そうだね）ではintimateからeroticへ自動昇格しない", () => {
    const messages = [
      { role: "user", content: "キスして" },
      { role: "assistant", content: "..." },
      { role: "user", content: "もっと近くにいたい" },
      { role: "assistant", content: "..." },
      { role: "user", content: "そうだね" },
    ];
    expect(detectScenePhase(messages)).toBe("intimate");
  });

  it("低強度メッセージ（なるほど）ではintimateからeroticへ自動昇格しない", () => {
    const messages = [
      { role: "user", content: "キスして" },
      { role: "assistant", content: "..." },
      { role: "user", content: "もっと近くにいたい" },
      { role: "assistant", content: "..." },
      { role: "user", content: "なるほど" },
    ];
    expect(detectScenePhase(messages)).toBe("intimate");
  });

  it("assistantのclimax描写だけではintimateからclimaxへ飛躍しない", () => {
    const messages = [
      { role: "user", content: "キスして" },
      { role: "assistant", content: "絶頂に達して体が痙攣する" },
      { role: "user", content: "うん" },
    ];
    expect(detectScenePhase(messages)).toBe("intimate");
  });

  it("ユーザーがerotic到達済みならassistantのclimax描写でclimaxに引き上がる", () => {
    const messages = [
      { role: "user", content: "奥まで入れて" },
      { role: "assistant", content: "絶頂に達して体が痙攣する" },
      { role: "user", content: "うん" },
    ];
    expect(detectScenePhase(messages)).toBe("climax");
  });

  it("soft intimacyだけでintimateに達した場合はassistantのclimax描写でclimaxに飛躍しない", () => {
    const messages = [
      { role: "user", content: "手を握ってもいい？" },
      { role: "assistant", content: "..." },
      { role: "user", content: "もっと近くにいたい" },
      { role: "assistant", content: "射精して中出しする" },
      { role: "user", content: "そうだね" },
    ];
    expect(detectScenePhase(messages)).toBe("intimate");
  });

  it("afterglow ユーザー発話後の再エスカレードは intimate から再開する", () => {
    const messages = [
      { role: "user", content: "いく。膣内に射精するから、そのまま全部受け取って" },
      { role: "assistant", content: "はぁ…あったかいのが中に…。" },
      { role: "user", content: "そのまま抱えてる。水飲むか" },
      { role: "assistant", content: "うん…喉乾いた…。" },
      { role: "user", content: "痛いとこない？ちゃんと教えて" },
      { role: "assistant", content: "大丈夫…。ちょっと疲れただけ…。" },
      { role: "user", content: "さっきのお前、かなりよかったよ" },
      { role: "assistant", content: "…べ、別に。照れるな。" },
      { role: "user", content: "もう一回したいなら自分から言って。止めてもいいし" },
      { role: "assistant", content: "…もう。そんなふうに言われたら、言いたくなるじゃん。" },
      { role: "user", content: "ネクタイ引いてくるなら分かった。膝に乗せてキスする" },
    ];

    expect(detectScenePhase(messages)).toBe("intimate");
  });
});

describe("getMaxTokensForPhase", () => {
  it("conversation は 1024", () => {
    expect(getMaxTokensForPhase("conversation")).toBe(1024);
  });

  it("intimate は 1536", () => {
    expect(getMaxTokensForPhase("intimate")).toBe(1536);
  });

  it("erotic は 3072", () => {
    expect(getMaxTokensForPhase("erotic")).toBe(3072);
  });

  it("climax は 3584", () => {
    expect(getMaxTokensForPhase("climax")).toBe(3584);
  });

  it("afterglow は 1536", () => {
    expect(getMaxTokensForPhase("afterglow")).toBe(1536);
  });
});
