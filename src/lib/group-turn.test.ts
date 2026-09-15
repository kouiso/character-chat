import { describe, expect, it } from "vitest";

import { selectRoundRobinSpeaker } from "./group-turn";

describe("selectRoundRobinSpeaker", () => {
  it("selects speakers in round-robin order", () => {
    const characterIds = ["a", "b", "c"];

    expect(selectRoundRobinSpeaker(characterIds, 0)).toBe("a");
    expect(selectRoundRobinSpeaker(characterIds, 1)).toBe("b");
    expect(selectRoundRobinSpeaker(characterIds, 2)).toBe("c");
    expect(selectRoundRobinSpeaker(characterIds, 3)).toBe("a");
  });

  it("returns null when no characters exist", () => {
    expect(selectRoundRobinSpeaker([], 2)).toBeNull();
  });
});
