import { createLogger } from "@/lib/logger";

// 名前を尋ねる導線（会話開始時に一度だけ）の既読フラグ。端末ローカルにのみ残す。
// 保存先そのもの（アカウントdisplayName/キャラ別userPersonaName）は既存のAPIを使い、
// ここは「もう尋ねたか」だけを持つ（スキップした場合も含めて既読扱い）。
const logger = createLogger("name-prompt-state");

const ASKED_KEY = "ou_name_prompt_asked";

export const hasAskedForName = (): boolean => {
  try {
    return localStorage.getItem(ASKED_KEY) === "1";
  } catch {
    // localStorage 不可時は二度と出さない（体験を止めない）
    return true;
  }
};

export const markNamePromptAsked = (): void => {
  try {
    localStorage.setItem(ASKED_KEY, "1");
  } catch {
    logger.warn("名前プロンプトの既読フラグを保存できませんでした");
  }
};
