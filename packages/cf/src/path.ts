import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const WRANGLER_CONFIG = path.join(REPO_ROOT, "apps/v2/wrangler.jsonc");

// CLI と Vite plugin は親ディレクトリを受け取って v3 を足すが、getPlatformProxy は実体を受け取る。
export const PERSIST_ROOT = path.join(REPO_ROOT, ".wrangler/state");
export const PERSIST_PATH = path.join(PERSIST_ROOT, "v3");
