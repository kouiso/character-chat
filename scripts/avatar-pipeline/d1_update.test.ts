import { describe, expect, it } from "vitest";
import { buildCharacterAvatarUpdateQuery, escapeSqlString, normalizeAvatarKey } from "./d1_update";

describe("d1_update utilities", () => {
  it("escapes single quotes for SQL inline values", () => {
    expect(escapeSqlString("a'b")).toBe("a''b");
  });

  it("handles repeated single quotes", () => {
    expect(escapeSqlString("''")).toBe("''''");
  });

  it("normalizes legacy static avatar paths to bare R2 keys", () => {
    expect(normalizeAvatarKey("/avatars/import-charap-x.png")).toBe("import-charap-x.png");
  });

  it("builds D1 updates with bare avatar keys only", () => {
    const query = buildCharacterAvatarUpdateQuery("char-1", "/avatars/import-charap-x.png", "a'b");

    expect(query).toContain("avatar = 'import-charap-x.png'");
    expect(query).not.toContain("/avatars/");
    expect(query).toContain("visual_prompt = 'a''b'");
  });

  it("rejects nested R2 object paths because character.avatar stores the bare key", () => {
    expect(() =>
      buildCharacterAvatarUpdateQuery("char-1", "avatars/import-charap-x.png", "prompt"),
    ).toThrow(/bare R2 key/);
  });
});
