import { defineConfig } from "vitest/config";

// root の vitest.config.ts は packages/** を include から外しとる（意図的）ので、
// @v2/engine 自身のテストは自分専用の config で回す。jest 時代のグローバル
// describe/it/expect をそのまま使うため globals を立てる。
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["__tests__/**/*.test.ts"],
  },
});
