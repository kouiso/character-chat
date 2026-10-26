import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [cloudflare({ configPath: "probe/wrangler.jsonc", viteEnvironment: { name: "ssr" } })],
  environments: { ssr: { build: { outDir: "dist/probe" } } },
});
