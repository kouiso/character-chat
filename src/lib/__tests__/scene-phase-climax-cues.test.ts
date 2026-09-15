import { describe, expect, it } from "vitest";

import { detectScenePhase } from "../scene-phase";

// 実測: 9 ターンの通しで「もう限界。全部、中で受け止めて。」が intimate のまま配信された。
// climax の「中」系キーワードは 中に出 / 中で出 / 中出 / 中でイ / 中でいく / 中でいき の
// 6 形だけで、いずれも「中で」の直後に 出 か イ を要求する。受け止める・注ぐ・満たす
// といった受け手側の言い方が一つも入っておらず、ユーザーが最も自然に打つ形で
// 絶頂フェーズへ入れんかった。intimate は挿入が STRICTLY FORBIDDEN なので、
// この取りこぼしは「押しても場面が進まん」として体験に直撃する。

const user = (content: string) => [{ role: "user", content }];

describe("detectScenePhase の中出し表現の取りこぼし", () => {
  it("受け手側の言い方でも climax に入る", () => {
    expect(detectScenePhase(user("もう限界。全部、中で受け止めて。"))).toBe("climax");
    expect(detectScenePhase(user("中に注いで"))).toBe("climax");
    expect(detectScenePhase(user("奥で受け止めて"))).toBe("climax");
  });

  it("従来の形は引き続き climax", () => {
    expect(detectScenePhase(user("中に出すよ"))).toBe("climax");
    expect(detectScenePhase(user("中出しする"))).toBe("climax");
  });

  it("日常の「受け止め」を climax に上げん", () => {
    expect(detectScenePhase(user("その気持ち、ちゃんと受け止めるよ"))).toBe("conversation");
    expect(detectScenePhase(user("荷物受け取っておいたよ"))).toBe("conversation");
  });
});
