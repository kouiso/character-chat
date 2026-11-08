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
      // Workers AI・Vectorize は手元に偽物が無く、remote 指定の環境（rag・staging）を vite dev / preview で
      // 起こすと Cloudflare の本物へつなぎに行く（資格情報が要り、本番の資源へ触る）。build と deploy には効かん。
      // 本物で試す時だけ、シェルで V2_REMOTE_BINDINGS=1 を付けて有効にする（.env では効かん）。
      remoteBindings: process.env.V2_REMOTE_BINDINGS === "1",
    }),
    tanstackStart({
      router: {
        codeSplittingOptions: {
          // 圏外の復帰先も初回表示済みとは限らないため、画面遷移に追加JS取得を要求しない。
          defaultBehavior: [],
        },
      },
    }),
    viteReact(),
  ],
});
