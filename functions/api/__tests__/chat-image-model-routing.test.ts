import { describe, expect, it } from "vitest";

import { CHAT_IMAGE_MODEL_BY_PHASE } from "../[[route]]";

const WAI = "waiNSFWIllustrious_v90_1187991.safetensors";

describe("chat image model routing", () => {
  // 局長決定 2026-07-12: プロフィール avatar と同じモデルに全 phase を統一する。
  // conversation だけ darkSushi に残すと avatar（waiNSFW 世代）とモデルが食い違い、
  // チャット中に出る画像がプロフと別人になる。
  it("全 phase が profile avatar と同じ waiNSFWIllustrious を使う", () => {
    for (const phase of ["conversation", "intimate", "erotic", "climax", "afterglow"] as const) {
      expect(CHAT_IMAGE_MODEL_BY_PHASE[phase]).toBe(WAI);
    }
  });

  it("darkSushi 世代のモデルはどの phase にも残っていない", () => {
    expect(Object.values(CHAT_IMAGE_MODEL_BY_PHASE)).not.toContain(
      "darkSushiMixMix_225D_64380.safetensors",
    );
  });
});
