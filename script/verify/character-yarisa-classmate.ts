import { existsSync, readFileSync } from "node:fs";

const seedPath = new URL("../seed.ts", import.meta.url);
const seedSource = readFileSync(seedPath, "utf-8");
const avatarPath = new URL("../../public/avatars/char-yarisa-classmate.jpg", import.meta.url);
const entryStart = seedSource.indexOf('id: "char-yarisa-classmate"');
const entryEnd = seedSource.indexOf("  },\n];", entryStart);

if (entryStart < 0 || entryEnd < 0) {
  console.error("[FAIL] char-yarisa-classmate seed entry was not found");
  process.exit(1);
}

const seedEntry = seedSource.slice(entryStart, entryEnd);

const expectedSnippets = [
  'id: "char-yarisa-classmate"',
  'name: "ヤリサーの同級生 チャラ男大学生"',
  "年齢: 20歳",
  "キャラ性別: 男。ユーザー性別: 男。関係: 大学同級生の男友達",
  "会話文脈: 男同士の雑談",
  "男友達",
  "自分の女体験を男友達に語る",
  "ユーザーは聞き役、ツッコミ役、一緒にナンパへ行く相棒",
  "昨日のサークル飲みで隣の子と帰っちゃってさー",
  "来週合コン組むんだけど来る？",
  "name_handling: お前 / 名前呼び / あだ名",
  "連れ込んだ、マジ最高",
  "反応エグかった",
  "性的な話題を振られたら",
  "急に諭す、焦る、関係が崩れる心配、真面目な忠告へ寄せない",
  "ヤリサー",
  "チャラ男",
  "adult university student",
];

const forbiddenSnippets = [
  "俺だけ見て",
  "お前と抜け出す",
  "手を取る",
  "本気で惹かれる",
  "友達関係が壊れる不安",
  "冗談も程々にしろ",
  "安全に話そう",
  "説教",
  "真面目モード",
  "真剣モード",
  "合意",
  "成人女性",
  "成人向け会話ルール",
];

const missing = expectedSnippets.filter((snippet) => !seedEntry.includes(snippet));
const forbidden = forbiddenSnippets.filter((snippet) => seedEntry.includes(snippet));

if (missing.length > 0 || forbidden.length > 0) {
  console.error("[FAIL] char-yarisa-classmate seed entry is incomplete");
  for (const snippet of missing) console.error(`missing: ${snippet}`);
  for (const snippet of forbidden) console.error(`forbidden: ${snippet}`);
  process.exit(1);
}

if (!existsSync(avatarPath)) {
  console.error("[FAIL] char-yarisa-classmate avatar is missing");
  process.exit(1);
}

console.log("[PASS] char-yarisa-classmate seed entry is male-friend oriented");
console.log("[PASS] char-yarisa-classmate avatar exists");
console.log("id: char-yarisa-classmate");
console.log("name: ヤリサーの同級生 チャラ男大学生");
