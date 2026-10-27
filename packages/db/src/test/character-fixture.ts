import type { CharacterSheet } from "../character";

export const characterFixture: CharacterSheet = {
  id: "synthetic-guide",
  name: "案内係",
  introduction: "街を紹介する案内係です。",
  tags: ["案内", "合成テスト"],
  greeting: "こんにちは。街を案内します。",
  systemPrompt: "わかりやすい言葉で案内してください。",
  exampleDialogue: "利用者: 図書館はどこですか。\n案内係: 広場の隣です。",
  world: "架空の小さな街",
  appearance: "青い上着と丸い帽子",
  age: 18,
  adultCategory: "general",
  proactiveSettings: { enabled: true, intervalMinutes: 30 },
  avatar: null,
  gender: null,
  slug: null,
  isOfficial: false,
  displayOrder: 0,
  createdAt: 1,
};
