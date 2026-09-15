import { describe, expect, it } from "vitest";

import { buildImageMetaAnchors } from "../lib/image-meta-anchor";

describe("buildImageMetaAnchors", () => {
  it("承認済みプロフィールの外見・画風・衣装を順序どおり保持する", () => {
    expect(
      buildImageMetaAnchors({
        appearance: "50/50 split black and white hair, blue eyes, natural proportions",
        artStyle: "anime screencap, clean line art",
        outfit: "black choker, silver hoop earrings",
        negativePrompt: "monochrome hair, large breasts",
      }),
    ).toEqual({
      positive:
        "50/50 split black and white hair, blue eyes, natural proportions, anime screencap, clean line art, black choker, silver hoop earrings",
      negative: "monochrome hair, large breasts",
    });
  });

  it("任意フィールドが無くても必須アンカーを変更しない", () => {
    expect(
      buildImageMetaAnchors({ appearance: "dark skin", artStyle: "soft anime shading" }),
    ).toEqual({ positive: "dark skin, soft anime shading", negative: "" });
  });
});
