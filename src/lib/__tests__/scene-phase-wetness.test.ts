import { describe, expect, it } from "vitest";

import { detectScenePhase } from "../scene-phase";

// ダウナー（霜月鈴）の開始シナリオは「雨に濡れて拾われる話」。
// erotic キーワードに裸の "濡れ" が入っとるため、実測でターン1の
// 「……助かった。ずぶ濡れで死ぬかと思った。」が erotic 判定になり、
// 3 ターン目には climax まで上がった（applyPhaseFloor は下げん）。
// キャラの設定そのものが構造的に誤判定を踏む状態やった。

const user = (content: string) => [{ role: "user", content }];

describe("detectScenePhase の 濡れ 誤爆", () => {
  it("雨で濡れた話を erotic に上げん", () => {
    expect(detectScenePhase(user("……助かった。ずぶ濡れで死ぬかと思った。"))).toBe("conversation");
    expect(detectScenePhase(user("雨に濡れて帰ってきた"))).toBe("conversation");
    expect(detectScenePhase(user("傘なくて濡れちゃったよ"))).toBe("conversation");
  });

  it("汗・涙で濡れた話も erotic に上げん", () => {
    // シャツ・着替え自体が intimate キーワードなので、濡れ 単独を見るため衣類語は外す。
    expect(detectScenePhase(user("汗で濡れたまま走ってきた"))).toBe("conversation");
    expect(detectScenePhase(user("涙で濡れた顔を拭く"))).toBe("conversation");
  });

  it("性的文脈の 濡れ は従来どおり拾う", () => {
    expect(detectScenePhase(user("すごい濡れてるね"))).not.toBe("conversation");
    expect(detectScenePhase(user("下着が濡れてる"))).not.toBe("conversation");
  });
});
