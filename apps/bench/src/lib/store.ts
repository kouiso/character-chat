/* eslint-disable no-console -- ベンチの出力そのもの。数字を標準出力に出すのがこの台の役目や */
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

// 保存先は JSONL 1本。D1 も Dexie も使わん。1万件を超えて検索が要る段になったら考える。

export function appendJsonl(path: string, record: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
}

export function readJsonl<T>(path: string): T[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const out: T[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      // 壊れた行は黙って捨てず、呼び出し側が件数差で気づけるようにログだけ出す
      console.error(`[store] 壊れた JSONL 行を飛ばした: ${line.slice(0, 80)}`);
    }
  }
  return out;
}
