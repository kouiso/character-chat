import { defineConfig } from "vitest/config";

// root の vitest.config.ts は packages/** を include から外しとる（意図的）ので、
// @v2/prompt 自身のテストは自分専用の config で回す。
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
