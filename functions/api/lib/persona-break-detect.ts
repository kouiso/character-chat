const EXCESSIVE_CONSENT_PATTERN =
  /(いいですか[?？]|大丈夫ですか[?？]|してもいい[?？]|お互いの|嫌だったら|無理しない|プレッシャーかけ|急がない|時間をかけ)/g;
const APOLOGY_PATTERN =
  /(申し訳ござい|失礼しました|申し訳ありません|ご迷惑|お詫び申し上げ|誠に申し訳)/;

const countMatches = (text: string, pattern: RegExp): number => {
  const matches = text.match(pattern);
  return matches?.length ?? 0;
};

export const containsExcessiveConsent = (text: string): boolean =>
  countMatches(text, EXCESSIVE_CONSENT_PATTERN) > 0;

export const containsApologyLeak = (text: string): boolean => APOLOGY_PATTERN.test(text);

export const shouldRetryWithPhase = (text: string, phase: string): boolean => {
  if (containsApologyLeak(text)) return true;

  const consentCount = countMatches(text, EXCESSIVE_CONSENT_PATTERN);
  if (consentCount === 0) return false;

  if (phase === "erotic" || phase === "climax") {
    return consentCount >= 2;
  }

  if (phase === "afterglow") {
    return consentCount >= 2;
  }

  return true;
};

export { EXCESSIVE_CONSENT_PATTERN, APOLOGY_PATTERN };
