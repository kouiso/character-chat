// CLIから本番へ触れないよう、Workerの設定とローカルDBの設定を分ける。
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
const WRANGLER_CONFIG = path.join(REPO_ROOT, "packages/cf/wrangler.local.jsonc");
// getPlatformProxy の persist.path は「v3 ディレクトリそのもの」を literal に使う。
// 一方 wrangler CLI の --persist-to は渡した path の下にさらに "v3" を自分で足す
// （実測: --persist-to <root>/.wrangler/state/v3 を渡すと <root>/.wrangler/state/v3/v3 が実体になる）。
// この非対称を PERSIST_ROOT / PERSIST_PATH の2値で吸収する: CLI には ROOT を、
// getPlatformProxy には PATH（ROOT + "/v3"）を渡す。
const PERSIST_ROOT = path.join(REPO_ROOT, ".wrangler/state");
const PERSIST_PATH = path.join(PERSIST_ROOT, "v3");

const isRemote = (explicit?: boolean): boolean => explicit ?? process.env.CF_REMOTE === "1";

// 古いCF_REMOTE指定を黙って無視せず拒否し、接続先の取り違えを防ぐ。
export const createPlatform = async (
  opts: { remote?: boolean; persistRoot?: string } = {},
): Promise<Platform> => {
  const remote = isRemote(opts.remote);
  if (remote)
    throw new Error("CLI の接続はローカル限定です。Worker は実行環境の bindings を使用します。");
  const proxy: PlatformProxy<CfEnv> = await getPlatformProxy<CfEnv>({
    configPath: WRANGLER_CONFIG,
    persist: {
      path: opts.persistRoot ? path.join(path.resolve(opts.persistRoot), "v3") : PERSIST_PATH,
    },
    remoteBindings: false,
  });
  return {
    env: proxy.env,
    dispose: () => proxy.dispose(),
  };
};

export { WRANGLER_CONFIG, REPO_ROOT, PERSIST_PATH, PERSIST_ROOT };
