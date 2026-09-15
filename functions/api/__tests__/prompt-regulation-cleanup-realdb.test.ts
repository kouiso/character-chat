// @vitest-environment node
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { DatabaseSync } from "node:sqlite";

const migration = readFileSync(
  new URL("../../../drizzle/0054_strip_regulatory_prompt_boilerplate.sql", import.meta.url),
  "utf8",
);

let DatabaseSyncCtor: typeof DatabaseSync | undefined;
try {
  const mod = await import("node:sqlite");
  DatabaseSyncCtor = mod.DatabaseSync;
} catch {
  // この Node ビルドでは node:sqlite が無効化されている。
}

const migrate = (...prompts: string[]): string[] => {
  if (!DatabaseSyncCtor) {
    throw new Error("node:sqlite is not available");
  }
  const database = new DatabaseSyncCtor(":memory:");
  database.exec("CREATE TABLE character (id TEXT PRIMARY KEY, system_prompt TEXT NOT NULL)");
  const insert = database.prepare("INSERT INTO character (id, system_prompt) VALUES (?, ?)");
  prompts.forEach((prompt, index) => insert.run(`char-${index}`, prompt));
  database.exec(migration);
  const rows = database.prepare("SELECT system_prompt FROM character ORDER BY id").all() as {
    system_prompt: string;
  }[];
  database.close();
  return rows.map((row) => row.system_prompt);
};

describe.skipIf(!DatabaseSyncCtor)("0054 regulatory prompt cleanup", () => {
  it("年齢のメタ指示を実年齢へ正規化する", () => {
    const [prompt] = migrate(`【キャラクター】
年齢: 18歳以上の成人
※成人向けseed用に全登場人物を18歳以上として再設定。
年齢: 明示がない場合も必ず20歳以上の成人として扱う`);

    expect(prompt).toContain("年齢: 18歳");
    expect(prompt).toContain("年齢: 20歳");
    expect(prompt).not.toMatch(/18歳以上|歳成人|成人として扱う|成人向けseed/u);
  });

  it("同意を会話進行条件にする定型指示を除く", () => {
    const [prompt] = migrate(`未成年設定には進めず、相手の同意と雰囲気を重視する。
- NSFW は相手の同意と反応を確認して進める。
- 合意済みの成人女性との合意行為を語る。
- このアプリは成人向けであり、合意ベースの性的話題を続ける。`);

    expect(prompt).toContain("場の雰囲気を重視する");
    expect(prompt).toContain("相手の反応を見ながら進める");
    expect(prompt).toContain("女性との性行為を語る");
    expect(prompt).toContain("性的話題を続ける");
    expect(prompt).not.toMatch(/未成年設定|同意|合意|成人女性|成人向け/u);
  });

  it("同意確認スクリプトを禁止する英語ガードは残す", () => {
    const [prompt] = migrate("- NG: labels, analysis, consent-check scripts, or meta-commentary");
    expect(prompt).toBe("- NG: labels, analysis, consent-check scripts, or meta-commentary");
  });
});
