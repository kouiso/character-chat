import { defineConfig } from "vitest/config";

// root の vitest.config.ts は packages/** を include から外しとる（意図的）ので、
// @v2/db 自身のテストは自分専用の config で回す。
// D1 を使うテストは wrangler migrations apply + getPlatformProxy の起動に数秒かかるので timeout を延ばす。
// 同じ sqlite（.wrangler/state/v3）を複数の Miniflare が同時に開かんよう、ファイル並列は切る。
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
});
