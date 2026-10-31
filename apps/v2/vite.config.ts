import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// 順序が重要: Start → React（Start のコード変換を React プラグインより先に通す）。
// POST /api/chat/$id は src/routes/api/chat/$id.ts の server.handlers（Start のサーバルート）。
export default defineConfig({
  plugins: [
    cloudflare({
      viteEnvironment: { name: "ssr" },
      persistState: { path: process.env.V2_LOCAL_PERSIST_ROOT ?? "../../.wrangler/state" },
    }),
    tanstackStart(),
    viteReact(),
  ],
});
