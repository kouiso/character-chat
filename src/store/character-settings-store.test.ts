import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  CHARACTER_SETTINGS_STORAGE_VERSION,
  DEFAULT_CHARACTER_SETTINGS,
  useCharacterSettingsStore,
  migrateCharacterSettings,
  shouldAttachAutoPhoto,
  useReplySettings,
} from "./character-settings-store";
import { useSettingsStore } from "./settings-store";

const CHARACTER_ID = "character-1";

const setGlobal = (responseLength: "short" | "medium", autoGenerateImages: boolean): void => {
  useSettingsStore.setState({ responseLength, autoGenerateImages });
};

describe("useReplySettings", () => {
  beforeEach(() => {
    localStorage.clear();
    useCharacterSettingsStore.setState({ byCharacter: {} });
    setGlobal("short", false);
  });

  it("一度も設定していない子は全体設定のまま（キャラ既定値で上書きしない）", () => {
    const { result } = renderHook(() => useReplySettings(CHARACTER_ID));

    expect(result.current.responseLength).toBe("short");
    expect(result.current.autoGenerateImages).toBe(false);
  });

  it("キャラ未選択でも全体設定のまま", () => {
    const { result } = renderHook(() => useReplySettings(null));

    expect(result.current.responseLength).toBe("short");
    expect(result.current.autoGenerateImages).toBe(false);
  });

  it("文章の長さはこの子の設定が全体設定に勝つ", () => {
    useCharacterSettingsStore.getState().patch(CHARACTER_ID, { responseLength: "very_long" });

    const { result } = renderHook(() => useReplySettings(CHARACTER_ID));

    expect(result.current.responseLength).toBe("very_long");
  });

  it("この子の設定は他の子に漏れない", () => {
    useCharacterSettingsStore.getState().patch(CHARACTER_ID, { responseLength: "very_long" });

    const { result } = renderHook(() => useReplySettings("character-2"));

    expect(result.current.responseLength).toBe("short");
  });

  it("写真を混ぜる ON はこの子だけ全体設定 OFF に勝つ", () => {
    useCharacterSettingsStore.getState().patch(CHARACTER_ID, { photoMix: true });

    const { result } = renderHook(() => useReplySettings(CHARACTER_ID));

    expect(result.current.autoGenerateImages).toBe(true);
  });

  it("写真を混ぜる OFF はこの子だけ全体設定 ON を止める", () => {
    setGlobal("medium", true);
    useCharacterSettingsStore.getState().patch(CHARACTER_ID, { photoMix: false });

    const { result } = renderHook(() => useReplySettings(CHARACTER_ID));

    expect(result.current.autoGenerateImages).toBe(false);
  });

  it("文章のみモードは写真を混ぜる設定より強い", () => {
    setGlobal("medium", true);
    useCharacterSettingsStore.getState().patch(CHARACTER_ID, { photoMix: true, textOnly: true });

    const { result } = renderHook(() => useReplySettings(CHARACTER_ID));

    expect(result.current.autoGenerateImages).toBe(false);
  });

  it("文章のみモードを戻すと全体設定へ戻る", () => {
    setGlobal("medium", true);
    useCharacterSettingsStore.getState().patch(CHARACTER_ID, { textOnly: true });
    useCharacterSettingsStore.getState().patch(CHARACTER_ID, { textOnly: false });

    const { result } = renderHook(() => useReplySettings(CHARACTER_ID));

    expect(result.current.autoGenerateImages).toBe(true);
  });
});

describe("DEFAULT_CHARACTER_SETTINGS", () => {
  // 既定値を「継承」以外にすると、一度も触っていない子で全体設定が黙って無効になる
  it("継承すべき項目の既定値は null", () => {
    expect(DEFAULT_CHARACTER_SETTINGS.responseLength).toBeNull();
    expect(DEFAULT_CHARACTER_SETTINGS.photoMix).toBeNull();
  });
});

describe("保存済み設定の移行", () => {
  const STORAGE_KEY = "ou-character-settings";

  // setState は persist の書き込みを誘発するので、先に汚してから保存値を置く。
  // 逆順にすると sentinel の書き込みが保存値を消してしまう。
  const rehydrateFrom = async (raw: string | null): Promise<void> => {
    useCharacterSettingsStore.setState({ byCharacter: { "sentinel-1": { textOnly: true } } });
    localStorage.clear();
    if (raw !== null) localStorage.setItem(STORAGE_KEY, raw);
    await useCharacterSettingsStore.persist.rehydrate();
  };

  beforeEach(() => {
    localStorage.clear();
    useCharacterSettingsStore.setState({ byCharacter: {} });
    setGlobal("short", false);
  });

  it("新規インストールは保存が無くても壊れず、全体設定を継承する", async () => {
    localStorage.clear();
    await useCharacterSettingsStore.persist.rehydrate();

    expect(useCharacterSettingsStore.getState().byCharacter).toEqual({});

    setGlobal("medium", true);
    const { result } = renderHook(() => useReplySettings(CHARACTER_ID));

    expect(result.current.responseLength).toBe("medium");
    expect(result.current.autoGenerateImages).toBe(true);
  });

  // 無反応だった頃のシートが書き残した値。今そのまま効かせると、ユーザーが一度も
  // 見たことのない挙動へ黙って切り替わる
  it("旧 shape の保存は捨てて全体設定の継承へ戻す", async () => {
    await rehydrateFrom(
      JSON.stringify({
        state: {
          byCharacter: {
            [CHARACTER_ID]: {
              responseLength: "very_long",
              photoMix: false,
              photoFrequency: 0.9,
              receiveVideo: true,
              textOnly: true,
            },
          },
        },
        version: 0,
      }),
    );

    expect(useCharacterSettingsStore.getState().byCharacter).toEqual({});

    setGlobal("medium", true);
    const { result } = renderHook(() => useReplySettings(CHARACTER_ID));

    expect(result.current.responseLength).toBe("medium");
    expect(result.current.autoGenerateImages).toBe(true);
  });

  // zustand は version が数値の時しか migrate を呼ばん。旧ビルドは version キー自体を
  // 書いておらず、補正しないと旧データが現行 shape として素通りする
  it("version キーの無い保存も移行対象にする", async () => {
    await rehydrateFrom(
      JSON.stringify({ state: { byCharacter: { [CHARACTER_ID]: { photoMix: false } } } }),
    );

    expect(useCharacterSettingsStore.getState().byCharacter).toEqual({});
  });

  it("現行 shape の保存はそのまま残す", async () => {
    await rehydrateFrom(
      JSON.stringify({
        state: {
          byCharacter: {
            [CHARACTER_ID]: { responseLength: "very_long", photoMix: false },
          },
        },
        version: CHARACTER_SETTINGS_STORAGE_VERSION,
      }),
    );

    expect(useCharacterSettingsStore.getState().byCharacter).toEqual({
      [CHARACTER_ID]: { responseLength: "very_long", photoMix: false },
    });

    setGlobal("medium", true);
    const { result } = renderHook(() => useReplySettings(CHARACTER_ID));

    expect(result.current.responseLength).toBe("very_long");
    expect(result.current.autoGenerateImages).toBe(false);
  });

  it("保存には現行 version が付く（次の移行が旧データを見分けられる）", () => {
    useCharacterSettingsStore.getState().patch(CHARACTER_ID, { textOnly: true });

    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");

    expect(stored).toMatchObject({ version: CHARACTER_SETTINGS_STORAGE_VERSION });
  });
});

// この子との設定が送信まで届くことは ou-app.test.tsx の
// 「OuApp この子との設定が送信まで届く」が実際に送って api の境界で確かめとる。
// ここに在った本文の substring 検査（useReplySettings を含む／characterId={activeCharId} を含む）は
// その振る舞いテストで置き換えたので落とした。あれは配線を切っても素通しする一方で、
// 振る舞いの変わらん改名だけで落ちる、という逆向きの網やった。
describe("送信経路が読む設定源", () => {
  // 書き手が居らんまま参照だけ残ると、消えたはずの設定源からの再流入に気づけん。
  // 振る舞いで固定でけへん「参照しとらんこと」だけをここに残す。
  it("書き手のいない solo-sub-character は読まない", () => {
    const ouApp = readFileSync(resolve(process.cwd(), "src/component/ouse/ou-app.tsx"), "utf8");

    expect(ouApp).not.toContain("solo-sub-character");
  });
});

describe("写真の頻度", () => {
  beforeEach(() => {
    localStorage.clear();
    useCharacterSettingsStore.setState({ byCharacter: {} });
    setGlobal("short", true);
  });

  // スライダーが誰にも読まれてへん間は毎回生成しとった。既定を 1 未満にすると、
  // 一度も触ってへん人の写真が黙って減る。
  it("既定は毎回付く", () => {
    const { result } = renderHook(() => useReplySettings(CHARACTER_ID));

    expect(result.current.photoFrequency).toBe(1);
    expect(shouldAttachAutoPhoto(true, result.current.photoFrequency, 0)).toBe(true);
    expect(shouldAttachAutoPhoto(true, result.current.photoFrequency, 0.999)).toBe(true);
  });

  it("この子の頻度が全体より優先される", () => {
    useCharacterSettingsStore.getState().patch(CHARACTER_ID, { photoFrequency: 0.3 });

    const { result } = renderHook(() => useReplySettings(CHARACTER_ID));

    expect(result.current.photoFrequency).toBe(0.3);
  });

  it("ひかえめ側いっぱい（0）なら一枚も付かん", () => {
    expect(shouldAttachAutoPhoto(true, 0, 0)).toBe(false);
    expect(shouldAttachAutoPhoto(true, 0, 0.5)).toBe(false);
  });

  it("頻度が残っとっても写真を混ぜるが OFF なら付かん", () => {
    expect(shouldAttachAutoPhoto(false, 1, 0)).toBe(false);
  });

  it("頻度どおりの割合で引く", () => {
    expect(shouldAttachAutoPhoto(true, 0.5, 0.49)).toBe(true);
    expect(shouldAttachAutoPhoto(true, 0.5, 0.5)).toBe(false);
  });
});

describe("migrateCharacterSettings", () => {
  // zustand は version が食い違えば必ず migrate を呼び、返り値を保存し直す。
  // version を見ずに捨てると、次の版上げで「修正後に正しく効いとった設定」まで消える。
  it("現行 version の保存はそのまま通す（将来の版上げで巻き添えにせん）", () => {
    const stored = { byCharacter: { [CHARACTER_ID]: { responseLength: "very_long" as const } } };

    expect(migrateCharacterSettings(stored, CHARACTER_SETTINGS_STORAGE_VERSION)).toBe(stored);
  });

  it("v1 未満（シートが無反応やった頃）の保存だけ捨てる", () => {
    const stored = { byCharacter: { [CHARACTER_ID]: { photoMix: false } } };

    expect(migrateCharacterSettings(stored, 0)).toEqual({ byCharacter: {} });
  });
});
