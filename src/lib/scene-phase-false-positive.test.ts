import { describe, expect, it } from "vitest";

import { detectScenePhase } from "./scene-phase";

const asUser = (content: string) => [{ role: "user", content }];

// エロ段階へ入ってから曖昧語を言う会話。ここでの「いく」は絶頂。
const inEroticScene = (last: string) => [
  { role: "user", content: "もっと奥まで突いて" },
  { role: "assistant", content: "……はぁ、こんなに濡れて。" },
  { role: "user", content: last },
];

// 2026-07-26: 「いく」「出して」「果て」を部分一致で並べとったため日常語が絶頂判定になっとった。
// 除外リストで日常語を数え上げる方式は敵対レビューで穴だらけと判明（「ゴミ出して」「宿題出して」
// 「元気を出して」が素通り）。語だけで決めず、会話がエロ段階に入っとる時だけ絶頂と読む。
describe("雑談では曖昧語を絶頂と読まん", () => {
  it.each([
    "いくつか聞きたいことがある",
    "いくらだった？",
    "コンビニいくわ",
    "今から行く",
    "ゴミ出して",
    "宿題出しておいた",
    "結果出しといて",
    "元気を出して",
    "声出して笑った",
    "勇気出してみる",
    "果てしない話やな",
    "こんばんは",
    // 2026-07-26 敵対レビュー第2ラウンドが第1版を壊した入力
    "明日どこいく。",
    "今からコンビニいく!",
    "頑張っていく。",
    "全力でいく!",
    "もういくね",
  ])("%s は conversation のまま", (message) => {
    expect(detectScenePhase(asUser(message) as never)).toBe("conversation");
  });
});

describe("段階に関係無く絶頂と読める形は拾う", () => {
  it.each([
    "もうだめいく",
    "もう無理いく",
    "いくっ",
    "いくぅ",
    "いきそう",
    "イク",
    "いっちゃう",
    "中に出して",
    "射精しそう",
    "絶頂した",
  ])("%s は climax", (message) => {
    expect(detectScenePhase(asUser(message) as never)).toBe("climax");
  });
});

describe("エロ段階に入っとれば曖昧語も絶頂と読む", () => {
  it.each(["いくわ", "いくよ", "いくの", "もういく", "出して", "果てる"])(
    "%s は climax",
    (message) => {
      expect(detectScenePhase(inEroticScene(message) as never)).toBe("climax");
    },
  );
});

describe("文脈パターンで絶頂した会話も余韻へ移れる", () => {
  it("いっちゃう で絶頂した後、毛布の話で afterglow になる", () => {
    const messages = [
      { role: "user", content: "もっと感じたい" },
      { role: "assistant", content: "……ん、そこ、だめ。" },
      { role: "user", content: "だめ、いっちゃう" },
      { role: "assistant", content: "わたしも、いっしょに……！" },
      { role: "user", content: "毛布をかけてくれる？" },
    ];
    expect(detectScenePhase(messages as never)).toBe("afterglow");
  });
});

describe("平場の会話が余韻へ飛ばん", () => {
  it("宿題出して＋おやすみ で afterglow にならん", () => {
    const messages = [
      { role: "user", content: "先生、宿題出して提出しました" },
      { role: "assistant", content: "お疲れ様。" },
      { role: "user", content: "今日は疲れたから寝るね、おやすみ" },
    ];
    expect(detectScenePhase(messages as never)).toBe("conversation");
  });
});
