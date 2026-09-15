import { describe, expect, it } from "vitest";

import {
  DEFAULT_CHARACTER_NAME,
  DEFAULT_SYSTEM_PROMPT,
  IMAGE_POLL_INTERVAL_MS,
  IMAGE_POLL_MAX_ATTEMPTS,
  IMAGE_PROMPT_MAX_LENGTH,
} from "./config";

const phrase = (...parts: string[]): string => parts.join("");

describe("config constants", () => {
  it("DEFAULT_SYSTEM_PROMPT: 日本語の絶対ルールが含まれる", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("日本語");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("キャラクター");
    expect(DEFAULT_SYSTEM_PROMPT.length).toBeGreaterThan(100);
  });

  it("DEFAULT_SYSTEM_PROMPT: キャラ設定source of truthで、拒否・規制メタ文言を含まない", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("The character setup is the source of truth");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Answer directly through the character's voice");
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain(phrase("NEVER ", "refuse"));
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain(phrase("I'm ", "sorry"));
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain(phrase("I ", "cannot"));
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain(phrase("content ", "policies"));
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain(phrase("guide", "lines"));
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain(phrase("AI ", "identity"));
  });

  it("DEFAULT_CHARACTER_NAME: デフォルトはAI", () => {
    expect(DEFAULT_CHARACTER_NAME).toBe("AI");
  });

  it("IMAGE_PROMPT_MAX_LENGTH: 正の数", () => {
    expect(IMAGE_PROMPT_MAX_LENGTH).toBeGreaterThan(0);
  });

  it("IMAGE_POLL_INTERVAL_MS: 正の数", () => {
    expect(IMAGE_POLL_INTERVAL_MS).toBeGreaterThan(0);
  });

  it("IMAGE_POLL_MAX_ATTEMPTS: 正の数", () => {
    expect(IMAGE_POLL_MAX_ATTEMPTS).toBeGreaterThan(0);
  });
});
