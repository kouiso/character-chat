import { readFileSync } from "node:fs";

// v1 凍結の引き継ぎ: /sw.js は _redirects のリライトで sw-kill.js（自害 SW）を返す形で、
// Workbox 生成物は dist/sw-workbox.js に逃がしてある。
// ここでは両者がその役割どおりに出力されているかを確認する。
const read = (name) => readFileSync(new URL(`../dist/${name}`, import.meta.url), "utf8");

const kill = read("sw-kill.js");
if (!kill.includes("self.registration.unregister()") || !kill.includes("caches.delete")) {
  throw new Error("dist/sw-kill.js is not the intended self-destroying handoff worker.");
}

const sw = read("sw-workbox.js");

const MIN_SIZE_BYTES = 1_000;

if (sw.length < MIN_SIZE_BYTES) {
  throw new Error(
    `dist/sw-workbox.js is too small (${sw.length} bytes). selfDestroying may still be enabled.`,
  );
}

if (sw.includes("self.registration.unregister()")) {
  throw new Error("dist/sw-workbox.js is still a self-destroying service worker.");
}

// Workbox の生成コードは minify されるので、precache manifest の {url:...}
// エントリと runtime caching の設定値そのものを検査する。
const entryCount = (sw.match(/\{url:/g) ?? []).length;
if (entryCount === 0) {
  throw new Error("dist/sw-workbox.js precache manifest is empty.");
}

if (!sw.includes("navigate") || !sw.includes("maxAgeSeconds:604800")) {
  throw new Error("dist/sw-workbox.js is missing the NetworkFirst navigation route.");
}

console.log(`PWA SW verified: ${entryCount} precache entries, ${sw.length} bytes.`);
