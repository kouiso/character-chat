import { describe, expect, it, vi } from "vitest";

import { applyCharacterOverride } from "../run";

import type { ScenarioDefinition } from "../scenario/_types";

const scenario = (
  scenarioId: string,
  characterSlug: string,
  turnCharacterSlugs: (string | undefined)[] = [undefined],
): ScenarioDefinition => ({
  scenarioId: scenarioId as ScenarioDefinition["scenarioId"],
  characterSlug,
  firstPerson: "あたし",
  turns: turnCharacterSlugs.map((turnCharacterSlug, index) => ({
    turnIndex: index + 1,
    userMsg: `turn ${index + 1}`,
    expectedPhase: "conversation" as const,
    ...(turnCharacterSlug ? { characterSlug: turnCharacterSlug } : {}),
  })),
});

describe("applyCharacterOverride", () => {
  it("指定が無ければ元のまま返す", () => {
    const scenarios = [scenario("S1", "char-tsukasa")];

    expect(applyCharacterOverride(scenarios, undefined)).toBe(scenarios);
    expect(applyCharacterOverride(scenarios, "   ")).toBe(scenarios);
  });

  it("シナリオ側の characterSlug を差し替える", () => {
    const overridden = applyCharacterOverride(
      [scenario("S1", "char-tsukasa"), scenario("S10", "char-saya")],
      "import-charap-ダウナーお姉さんに拾われる話",
    );

    expect(overridden.map((entry) => entry.characterSlug)).toEqual([
      "import-charap-ダウナーお姉さんに拾われる話",
      "import-charap-ダウナーお姉さんに拾われる話",
    ]);
  });

  // S4 はキャラを切り替えること自体が検査対象なので、ターン側の指定は残さなあかん。
  it("ターンごとの characterSlug は差し替えず、件数を警告する", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const overridden = applyCharacterOverride(
      [scenario("S4", "char-tsukasa", [undefined, "char-saya", "char-rinka"])],
      "sakura",
    );

    expect(overridden[0]?.characterSlug).toBe("sakura");
    expect(overridden[0]?.turns.map((turn) => turn.characterSlug)).toEqual([
      undefined,
      "char-saya",
      "char-rinka",
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("2 件のターン"));

    warn.mockRestore();
  });

  it("一人称も一緒に差し替えられる", () => {
    const overridden = applyCharacterOverride([scenario("S1", "char-tsukasa")], "sakura", "私");

    expect(overridden[0]?.firstPerson).toBe("私");
  });

  // 一人称を指定せんかった時は台本の値を残す。黙って別人の一人称を名乗らせん。
  it("一人称の指定が無ければ台本の値を残し、警告する", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const overridden = applyCharacterOverride([scenario("S1", "char-tsukasa")], "sakura");

    expect(overridden[0]?.firstPerson).toBe("あたし");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("E2E_CHARACTER_FIRST_PERSON"));

    warn.mockRestore();
  });

  it("元の配列を書き換えん", () => {
    const scenarios = [scenario("S1", "char-tsukasa")];

    applyCharacterOverride(scenarios, "sakura");

    expect(scenarios[0]?.characterSlug).toBe("char-tsukasa");
  });
});
