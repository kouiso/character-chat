// getPlatformProxy（Miniflare のローカル D1/R2）をプロセスで 1 回だけ起こす。
// Vite dev の SSR モジュール再評価（HMR）でこのファイルが読み直されても二重起動せんよう、
// キャッシュはモジュールスコープやのうて globalThis に置く（doc/v2/scaffold-spec.md §14-4）。
import { createPlatform, type Platform } from "@v2/cf";

const PLATFORM_KEY = Symbol.for("adult-ai-v2.platform");

type PlatformHolder = { [PLATFORM_KEY]?: Promise<Platform> };

export const getPlatform = (): Promise<Platform> => {
  const holder = globalThis as PlatformHolder;
  holder[PLATFORM_KEY] ??= createPlatform();
  return holder[PLATFORM_KEY];
};
