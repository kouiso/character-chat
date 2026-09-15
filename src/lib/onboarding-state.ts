import { createLogger } from "@/lib/logger";

// オンボーディング（設計 2d）の初回判定と選択の保存。端末ローカルにのみ残す。
const logger = createLogger("onboarding-state");

const ONBOARDED_KEY = "ou_onboarded";
const PREFS_KEY = "ou-onboarding-prefs";

export const hasOnboarded = (): boolean => {
  try {
    return localStorage.getItem(ONBOARDED_KEY) === "1";
  } catch {
    // localStorage 不可時は導入を出さない（体験を止めない）
    return true;
  }
};

export const saveOnboarding = (prefs: Record<string, string>): void => {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    localStorage.setItem(ONBOARDED_KEY, "1");
  } catch {
    logger.warn("オンボーディング設定の保存に失敗しました");
  }
};
