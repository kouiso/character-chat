import { readFileSync } from "node:fs";

const swPath = new URL("../dist/sw.js", import.meta.url);
const sw = readFileSync(swPath, "utf8");

const MIN_SIZE_BYTES = 1_000;

if (sw.length < MIN_SIZE_BYTES) {
  throw new Error(`dist/sw.js is too small (${sw.length} bytes). selfDestroying may still be enabled.`);
}

if (!sw.includes("precacheAndRoute")) {
  throw new Error("dist/sw.js does not contain precacheAndRoute.");
}

if (sw.includes("self.registration.unregister()")) {
  throw new Error("dist/sw.js is still a self-destroying service worker.");
}

const manifestMatch = sw.match(/precacheAndRoute\(([\s\S]*?)\)/);
if (!manifestMatch) {
  throw new Error("Could not extract precache manifest from dist/sw.js.");
}

const manifestText = manifestMatch[1];
const entryCount = (manifestText.match(/\{url:/g) ?? []).length;
if (entryCount === 0) {
  throw new Error("dist/sw.js precache manifest is empty.");
}

if (!sw.includes("NetworkFirst") || !sw.includes("PrecacheFallbackPlugin")) {
  throw new Error("dist/sw.js is missing NetworkFirst navigation route or precacheFallback.");
}

console.log(`PWA SW verified: ${entryCount} precache entries, ${sw.length} bytes.`);
