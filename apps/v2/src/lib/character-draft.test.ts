import { beforeEach, describe, expect, it } from "vitest";

import {
  characterDraftStorageKey,
  clearCharacterDraft,
  createCharacterDraft,
  createDraftFromIdea,
  loadCharacterDraft,
  persistCharacterDraft,
  validateCharacterDraft,
} from "./character-draft";

const validDraft = () => ({
  ...createCharacterDraft(null),
  name: "案内係",
  greeting: "こんにちは。",
  systemPrompt: "架空の街を案内してください。",
  age: "18",
});

describe("character draft", () => {
  beforeEach(() => localStorage.clear());

  it("18歳の入力を数値へ変換し、新規キャラの公式状態をfalseにする", () => {
    const draft = validDraft();
    const result = validateCharacterDraft({ ...draft, tags: "街\n 案内 \n" }, null);
    expect(result.errors).toBeNull();
    expect(result.sheet).toMatchObject({
      id: draft.id,
      age: 18,
      tags: ["街", "案内"],
      isOfficial: false,
    });
  });

  it.each(["17", "", "eighteen", "18.1", "18歳", " 18", "1e2"])(
    "不正な年齢入力 %s を拒否する",
    (age) => {
      expect(validateCharacterDraft({ ...validDraft(), age }, null).errors?.age).toBe(
        "18歳以上の整数を入力してください。",
      );
    },
  );

  it("下書きの未入力・不正な文字もそのまま復元する", () => {
    const draft = { ...validDraft(), age: "seventeen", idea: "案内係の案" };
    expect(persistCharacterDraft(localStorage, "actor/new", null, draft)).toBeNull();
    expect(loadCharacterDraft(localStorage, "actor/new", null)).toEqual({ draft, error: null });
    expect(loadCharacterDraft(localStorage, "other/new", null).draft).toBeNull();
    expect(clearCharacterDraft(localStorage, "actor/new")).toBeNull();
    expect(localStorage.getItem(characterDraftStorageKey("actor/new"))).toBeNull();
  });

  it("壊れた保存内容を既存の入力と取り違えない", () => {
    localStorage.setItem(characterDraftStorageKey("draft"), "not-json");
    expect(loadCharacterDraft(localStorage, "draft", null)).toEqual({
      draft: null,
      error: "端末の下書きを読み込めませんでした。",
    });
  });

  it("短い案から空欄だけを埋め、入力済み設定と年齢を保持する", () => {
    const draft = { ...validDraft(), introduction: "", age: "" };
    const filled = createDraftFromIdea(draft, "図書館の受付係");
    expect(filled.name).toBe(draft.name);
    expect(filled.systemPrompt).toBe(draft.systemPrompt);
    expect(filled.introduction).toBe("図書館の受付係");
    expect(filled.age).toBe("");
  });

  it("端末保存失敗を入力データを捨てずに報告する", () => {
    const storage = {
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(persistCharacterDraft(storage, "draft", null, validDraft())).toContain("保存できません");
    expect(loadCharacterDraft(null, "draft", null).error).toContain("読み込めません");
    expect(clearCharacterDraft(null, "draft")).toContain("削除できません");
  });
});
