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
      persistState: { path: "../../.wrangler/state" },
      // Workers AI・Vectorize は手元に偽物が無く、既定のままやと dev が Cloudflare の本物へ
      // つなぎに行く（資格情報が要り、CI の verify:ci も止まる）。本物で試す時だけ明示して有効にする。
      remoteBindings: process.env.V2_REMOTE_BINDINGS === "1",
    }),
    tanstackStart(),
    viteReact(),
  ],
});
