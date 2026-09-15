import path from "path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "AI Chat",
        short_name: "AIChat",
        description: "AI Chat & Image Generation",
        theme_color: "#09090b",
        background_color: "#09090b",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        id: "/",
        icons: [
          { src: "/pwa-64x64.png", sizes: "64x64", type: "image/png" },
          { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/maskable-icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // 認証付きアプリでは、キャッシュ優先の navigation fallback を使うと
        // Basic 認証チャレンジを踏めず API だけ 401 になり得る。
        // そのためデフォルトの navigateFallback を無効化し、ナビゲーションは
        // NetworkFirst（タイムアウトは precached index.html にフォールバック）で処理する。
        navigateFallback: null,
        globPatterns: ["**/*.{html,js,css,ico,svg,woff2,png,webmanifest}"],
        globIgnores: ["**/avatars/**"],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            // ナビゲーションは常にネットワークを優先し、オフライン/タイムアウト時のみ
            // 事前キャッシュした index.html を返す。これにより Basic 認証チャレンジを
            // 維持しつつ、PWA のオフラインコールドスタートが成立する。
            urlPattern: ({ request }) => request.mode === "navigate",
            handler: "NetworkFirst",
            options: {
              cacheName: "pages",
              networkTimeoutSeconds: 3,
              precacheFallback: { fallbackURL: "/index.html" },
              cacheableResponse: { statuses: [0, 200] },
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 7 * 24 * 60 * 60,
              },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    allowedHosts: true,
    proxy: {
      "/api": {
        target: "http://localhost:8788",
        changeOrigin: true,
      },
    },
  },
});
