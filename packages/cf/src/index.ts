// Miniflare ローカル D1/R2 束縛（既定）。CF_REMOTE=1 のときだけ Mac 専用の remote bindings を使う。
import { getPlatformProxy, type PlatformProxy } from "wrangler";

import { PERSIST_PATH, PERSIST_ROOT, REPO_ROOT, WRANGLER_CONFIG } from "./path";

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
