// Miniflare ローカル D1/R2 束縛（既定）。CF_REMOTE=1 のときだけ Mac 専用の remote bindings を使う。
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getPlatformProxy, type PlatformProxy } from "wrangler";

export type CfEnv = {
  DB: D1Database;
  BUCKET: R2Bucket;
  OPENROUTER_API_KEY?: string;
  V2_MODEL?: string;
};

export type Platform = {
  env: CfEnv;
  dispose: () => Promise<void>;
};

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const WRANGLER_CONFIG = path.join(REPO_ROOT, "apps/v2/wrangler.jsonc");
// getPlatformProxy の persist.path は「v3 ディレクトリそのもの」を literal に使う。
// 一方 wrangler CLI の --persist-to は渡した path の下にさらに "v3" を自分で足す
// （実測: --persist-to <root>/.wrangler/state/v3 を渡すと <root>/.wrangler/state/v3/v3 が実体になる）。
// この非対称を PERSIST_ROOT / PERSIST_PATH の2値で吸収する: CLI には ROOT を、
// getPlatformProxy には PATH（ROOT + "/v3"）を渡す。
const PERSIST_ROOT = path.join(REPO_ROOT, ".wrangler/state");
const PERSIST_PATH = path.join(PERSIST_ROOT, "v3");

const isRemote = (explicit?: boolean): boolean => explicit ?? process.env.CF_REMOTE === "1";

/**
 * ローカル D1/R2（既定）または CF_REMOTE=1 時のみ Mac 専用 remote bindings を束縛する。
 * remoteBindings は明示 false 既定（spec: CF_REMOTE=1 の時だけ true）。
 */
export const createPlatform = async (opts: { remote?: boolean } = {}): Promise<Platform> => {
  const remote = isRemote(opts.remote);
  const proxy: PlatformProxy<CfEnv> = await getPlatformProxy<CfEnv>({
    configPath: WRANGLER_CONFIG,
    persist: { path: PERSIST_PATH },
    remoteBindings: remote,
    environment: remote ? "remote" : undefined,
  });
  return {
    env: proxy.env,
    dispose: () => proxy.dispose(),
  };
};

export { WRANGLER_CONFIG, REPO_ROOT, PERSIST_PATH, PERSIST_ROOT };
