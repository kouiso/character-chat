import { describe, expect, it } from "vitest";

import { characterContentSchema } from "./character-version";

const valid = {
  name: "案内役",
  personality: "旅の案内人",
  speechStyle: "丁寧に話す",
  greeting: "こんにちは。",
};

describe("characterContentSchema の記憶の方針", () => {
  it("memoryInstruction は 2000 字まで通り、2001 字は失敗する", () => {
    const ok = characterContentSchema.safeParse({
      ...valid,
      memoryInstruction: "あ".repeat(2000),
    });
    expect(ok.success).toBe(true);
    const tooLong = characterContentSchema.safeParse({
      ...valid,
      memoryInstruction: "あ".repeat(2001),
    });
    expect(tooLong.success).toBe(false);
  });

  it("memoryKinds は両方切った空配列をそのまま受け入れ、未指定なら全種類を既定にする", () => {
    const none = characterContentSchema.safeParse({ ...valid, memoryKinds: [] });
    expect(none.success).toBe(true);
    if (none.success) expect(none.data.memoryKinds).toEqual([]);

    const byDefault = characterContentSchema.parse(valid);
    expect(byDefault.memoryKinds).toEqual(["fact", "preference"]);
    expect(byDefault.memoryInstruction).toBe("");
  });
});
