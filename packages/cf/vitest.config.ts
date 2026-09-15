import { defineConfig } from "vitest/config";

// root の vitest.config.ts は packages/** を include から外しとる（意図的）ので、
// @v2/cf 自身のテストは自分専用の config で回す。
// wrangler migrations apply + getPlatformProxy の初回起動は数秒かかるので hook timeout を延ばす。
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
});
