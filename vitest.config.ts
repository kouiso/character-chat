import path from "path";

import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "virtual:pwa-register/react": path.resolve(
        __dirname,
        "./src/test/virtual-pwa-register-react.ts",
      ),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: [
      "src/**/*.test.{ts,tsx}",
      "script/**/*.test.ts",
      "scripts/**/*.test.ts",
      // __tests__ 配下だけを拾う形やと functions/api/lib/*.test.ts が収集されず、
      // app-jwt.test.ts(JWT検証) が存在するのに走っとらんかった。配置場所に依存させん。
      "functions/**/*.test.ts",
    ],
    // apps/, packages/ は include で既に外れとるが、v2 monorepo の存在を明示しとく
    // （@v2/* パッケージは vitest 自身の `test` script を持ち、`pnpm v2:test` から回す）。
    exclude: [...configDefaults.exclude, "apps/**", "packages/**"],
    coverage: {
      provider: "v8",
      include: ["src/lib/**", "src/store/**", "functions/api/**"],
      exclude: [
        // api.ts now has tests via api.test.ts + api-transport.test.ts (#185)
        "src/lib/query-client.ts",
        "src/lib/query-key.ts",
        "src/lib/character-generator.ts",
        "src/lib/tts-constants.ts",
        "src/lib/utils.ts",
        // schema/* は Drizzle の宣言的定義でランタイム関数がなく coverage に含めない
        "src/schema/**",
      ],
      // 閾値は「下げた」のではなく計測対象を広げた結果の実測値。
      // 従来は functions/api/lib/** だけを見ており、5,097行の [[route]].ts が対象外
      // やった。しかも CI からは一度も実行されておらず強制力ゼロやった。対象を
      // functions/api/** 全体へ広げ、現在値を床として CI で強制する。
      // ルータを10本のサブルータへ切り出して HTTP テストを足した分、床を上げ直した。
      // 下げたまま置くと、足したテストを消しても CI が気づかん状態が続く。
      // 実測 77.74 / 68.19 / 80.19 / 78.99 に対し、揺らぎ分だけ余裕を持たせとる。
      thresholds: {
        lines: 77,
        functions: 79,
        branches: 67,
        statements: 76,
      },
    },
  },
});
