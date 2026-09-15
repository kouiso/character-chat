import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// tanstackStart() プラグインは無し（ルートジェネレータがファイル走査で routeTree.gen.ts を
// 要求し、テスト実行のたびに副作用が出るのを避けるため）。テストは component/ の純粋な
// React コンポーネントだけを対象にする。
export default defineConfig({
  plugins: [viteReact()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.tsx", "src/**/*.test.ts"],
  },
});
