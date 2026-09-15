import { readFileSync } from "node:fs";

// 鍵は .dev.vars から読む。ベンチ用に新しく鍵を配ることはせん。
// 値は絶対にログにも JSONL にも出さん。

export function loadDevVars(path: string): Record<string, string> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

export const REPO_ROOT = new URL("../../../../", import.meta.url).pathname;

export function requireOpenRouterKey(): string {
  const fromEnv = process.env.OPENROUTER_API_KEY;
  if (fromEnv) return fromEnv;
  const key = loadDevVars(`${REPO_ROOT}.dev.vars`).OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY が無い。環境変数か .dev.vars に置いてから回して。");
  return key;
}
