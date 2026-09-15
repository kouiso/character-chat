import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const src = join(process.cwd(), "evals", "score-index.jsonl");
const destDir = join(process.cwd(), "public", "admin-data");
const dest = join(destDir, "score-index.jsonl");

if (!existsSync(destDir)) {
  mkdirSync(destDir, { recursive: true });
}

if (existsSync(src)) {
  copyFileSync(src, dest);
  console.log("Copied score-index.jsonl to public/admin-data/");
} else {
  writeFileSync(dest, "");
  console.log("score-index.jsonl not found; created empty placeholder.");
}
