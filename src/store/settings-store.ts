import { z } from "zod/v4";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { createLogger } from "@/lib/logger";
import { DEFAULT_CHAT_MODEL } from "@/lib/model";

const logger = createLogger("settings");
const DEFAULT_MODEL = DEFAULT_CHAT_MODEL;

const persistedSettingsSchema = z.object({
  model: z.string().default(DEFAULT_MODEL),
  nsfwBlur: z.boolean().default(false),
  darkMode: z.boolean().default(true),
  autoGenerateImages: z.boolean().default(true),
  autoExtractMemories: z.boolean().default(true),
  ttsEnabled: z.boolean().default(false),
  ttsVoiceUri: z.string().default(""),
  ttsRate: z.number().min(0.5).max(2).default(1),
  ttsPitch: z.number().min(0.5).max(2).default(1),
  activeCharacterId: z.string().nullable().default(null),
  userProfile: z.string().max(2000).default(""),
  // B3: AIからユーザーへの呼び方（「ご主人様」等）
  userRole: z.string().max(50).default(""),
  // #111: 応答文章量プリセット
  responseLength: z.enum(["short", "medium", "long", "very_long"]).default("medium"),
  imageProvider: z.enum(["auto", "novita"]).default("novita"),
});

type PersistedSettings = z.infer<typeof persistedSettingsSchema>;

export type ResponseLength = "short" | "medium" | "long" | "very_long";
export type ImageProvider = "auto" | "novita";

interface SettingsState {
  model: string;
  nsfwBlur: boolean;
  darkMode: boolean;
  autoGenerateImages: boolean;
  autoExtractMemories: boolean;
  ttsEnabled: boolean;
  ttsVoiceUri: string;
  ttsRate: number;
  ttsPitch: number;
  activeCharacterId: string | null;
  userProfile: string;
  userRole: string;
  responseLength: ResponseLength;
  imageProvider: ImageProvider;
  toggleNsfwBlur: () => void;
  toggleDarkMode: () => void;
  toggleAutoGenerateImages: () => void;
  toggleAutoExtractMemories: () => void;
  toggleTts: () => void;
  setTtsVoiceUri: (uri: string) => void;
  setTtsRate: (rate: number) => void;
  setTtsPitch: (pitch: number) => void;
  setActiveCharacterId: (id: string | null) => void;
  setUserProfile: (profile: string) => void;
  setUserRole: (role: string) => void;
  setResponseLength: (length: ResponseLength) => void;
  setImageProvider: (provider: ImageProvider) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      model: DEFAULT_MODEL,
      nsfwBlur: false,
      darkMode: true,
      autoGenerateImages: true,
      autoExtractMemories: true,
      ttsEnabled: false,
      ttsVoiceUri: "",
      ttsRate: 1,
      ttsPitch: 1,
      activeCharacterId: null,
      userProfile: "",
      userRole: "",
      responseLength: "medium",
      imageProvider: "novita",
      toggleNsfwBlur: () => set((s) => ({ nsfwBlur: !s.nsfwBlur })),
      toggleDarkMode: () => set((s) => ({ darkMode: !s.darkMode })),
      toggleAutoGenerateImages: () => set((s) => ({ autoGenerateImages: !s.autoGenerateImages })),
      toggleAutoExtractMemories: () =>
        set((s) => ({ autoExtractMemories: !s.autoExtractMemories })),
      toggleTts: () => set((s) => ({ ttsEnabled: !s.ttsEnabled })),
      setTtsVoiceUri: (uri) => set({ ttsVoiceUri: uri }),
      setTtsRate: (rate) => set({ ttsRate: rate }),
      setTtsPitch: (pitch) => set({ ttsPitch: pitch }),
      setActiveCharacterId: (id) => set({ activeCharacterId: id }),
      setUserProfile: (profile) => set({ userProfile: profile }),
      setUserRole: (role) => set({ userRole: role }),
      setResponseLength: (length) => set({ responseLength: length }),
      setImageProvider: (provider) => set({ imageProvider: provider }),
    }),
    {
      name: "ai-chat-settings",
      version: 30,
      migrate: (persistedState: unknown, version: number): PersistedSettings => {
        const result = persistedSettingsSchema.safeParse(persistedState);
        const parsed = result.success
          ? result.data
          : ({
              model: DEFAULT_MODEL,
              nsfwBlur: false,
              darkMode: true,
              autoGenerateImages: true,
              autoExtractMemories: true,
              ttsEnabled: false,
              ttsVoiceUri: "",
              ttsRate: 1,
              ttsPitch: 1,
              activeCharacterId: null,
              userProfile: "",
              userRole: "",
              responseLength: "medium",
              imageProvider: "novita",
            } satisfies PersistedSettings);
        // v21: アダルトアプリなのでぼかしデフォルトOFFに変更。既存ユーザーも移行
        if (version < 21 && parsed.nsfwBlur === true) {
          parsed.nsfwBlur = false;
        }
        // v29: モデル選択UIを廃止。保存済みの選択を既定へ統一し、
        // 官能シーンのMagnum切替はバックエンドのphase自動ルーティングに委ねる。
        if (version < 29) {
          parsed.model = DEFAULT_MODEL;
        }
        // v30: 画像自動生成はアプリの主役体験なので、既存ユーザーも既定ONへ揃える。
        if (version < 30) {
          parsed.autoGenerateImages = true;
        }
        return parsed;
      },
      partialize: (state): PersistedSettings => ({
        model: state.model,
        nsfwBlur: state.nsfwBlur,
        darkMode: state.darkMode,
        autoGenerateImages: state.autoGenerateImages,
        autoExtractMemories: state.autoExtractMemories,
        ttsEnabled: state.ttsEnabled,
        ttsVoiceUri: state.ttsVoiceUri,
        ttsRate: state.ttsRate,
        ttsPitch: state.ttsPitch,
        activeCharacterId: state.activeCharacterId,
        userProfile: state.userProfile,
        userRole: state.userRole,
        responseLength: state.responseLength,
        imageProvider: state.imageProvider,
      }),
      // localStorage quota超過やプライベートブラウジング時のエラーを吸収する
      storage: createJSONStorage(() => ({
        getItem: (name: string) => {
          try {
            return localStorage.getItem(name);
          } catch {
            logger.warn(`localStorage.getItem("${name}") failed`);
            return null;
          }
        },
        setItem: (name: string, value: string) => {
          try {
            localStorage.setItem(name, value);
          } catch {
            logger.warn(`localStorage.setItem("${name}") failed (quota?)`);
          }
        },
        removeItem: (name: string) => {
          try {
            localStorage.removeItem(name);
          } catch {
            logger.warn(`localStorage.removeItem("${name}") failed`);
          }
        },
      })),
    },
  ),
);
