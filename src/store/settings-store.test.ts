import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_CHAT_MODEL } from "@/lib/model";

import { useSettingsStore } from "./settings-store";

describe("useSettingsStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({
      model: "sao10k/l3.1-euryale-70b",
      nsfwBlur: false,
      darkMode: true,
      autoGenerateImages: false,
      ttsEnabled: false,
      ttsVoiceUri: "",
      ttsRate: 1,
      ttsPitch: 1,
      activeCharacterId: null,
    });
  });

  it("toggleNsfwBlur: NSFWぼかしがトグルされる", () => {
    expect(useSettingsStore.getState().nsfwBlur).toBe(false);
    useSettingsStore.getState().toggleNsfwBlur();
    expect(useSettingsStore.getState().nsfwBlur).toBe(true);
    useSettingsStore.getState().toggleNsfwBlur();
    expect(useSettingsStore.getState().nsfwBlur).toBe(false);
  });

  it("toggleDarkMode: ダークモードがトグルされる", () => {
    expect(useSettingsStore.getState().darkMode).toBe(true);
    useSettingsStore.getState().toggleDarkMode();
    expect(useSettingsStore.getState().darkMode).toBe(false);
  });

  it("toggleAutoGenerateImages: 自動画像生成がトグルされる", () => {
    useSettingsStore.setState({ autoGenerateImages: true });
    expect(useSettingsStore.getState().autoGenerateImages).toBe(true);
    useSettingsStore.getState().toggleAutoGenerateImages();
    expect(useSettingsStore.getState().autoGenerateImages).toBe(false);
  });

  it("toggleTts: TTS設定がトグルされる", () => {
    expect(useSettingsStore.getState().ttsEnabled).toBe(false);
    useSettingsStore.getState().toggleTts();
    expect(useSettingsStore.getState().ttsEnabled).toBe(true);
  });

  it("setTtsRate / setTtsPitch: TTS速度・ピッチが変更される", () => {
    useSettingsStore.getState().setTtsRate(1.5);
    expect(useSettingsStore.getState().ttsRate).toBe(1.5);

    useSettingsStore.getState().setTtsPitch(0.8);
    expect(useSettingsStore.getState().ttsPitch).toBe(0.8);
  });

  it("v29: モデル選択廃止に伴い、保存済みの選択を既定モデルへ統一する", async () => {
    // 旧UIで明示選択していた非既定モデルも含め、全て既定へ寄せる
    localStorage.setItem(
      "ai-chat-settings",
      JSON.stringify({
        state: {
          model: "anthropic/claude-sonnet-4-6",
          nsfwBlur: false,
          darkMode: true,
          autoGenerateImages: false,
          ttsEnabled: false,
          ttsVoiceUri: "",
          ttsRate: 1,
          ttsPitch: 1,
          activeCharacterId: null,
        },
        version: 28,
      }),
    );

    await useSettingsStore.persist.rehydrate();

    expect(useSettingsStore.getState().model).toBe(DEFAULT_CHAT_MODEL);
  });

  it("v30: 保存済みの自動画像生成OFFを既定ONへ移行する", async () => {
    // 画像自動生成は主役体験なので、旧設定のOFFも新既定へ揃える
    localStorage.setItem(
      "ai-chat-settings",
      JSON.stringify({
        state: {
          model: DEFAULT_CHAT_MODEL,
          nsfwBlur: false,
          darkMode: true,
          autoGenerateImages: false,
          ttsEnabled: false,
          ttsVoiceUri: "",
          ttsRate: 1,
          ttsPitch: 1,
          activeCharacterId: null,
        },
        version: 29,
      }),
    );

    await useSettingsStore.persist.rehydrate();

    expect(useSettingsStore.getState().autoGenerateImages).toBe(true);
  });
});
