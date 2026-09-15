// Deterministic frontend BOOT-SMOKE guard.
//
// Why this exists: a class of bugs (e.g. an invalid `/u` regex escape that throws
// a SyntaxError during module evaluation) builds cleanly under tsc + esbuild/vite
// and passes every AI reviewer, yet blanks the entire app at runtime — the
// #708 white-screen incident. tsc/esbuild treat regex literals as opaque, so the
// SyntaxError only surfaces when a real browser evaluates the bundle.
//
// This script closes that gap deterministically: it serves the built `dist/` in a
// headless Chromium, and FAILS (non-zero exit) if the app throws ANY uncaught page
// error at boot OR if #root never becomes non-empty (white screen). No AI judgement,
// no network — a pure pass/fail signal suitable for a CI merge gate.
//
// Usage: `pnpm smoke`  (= `pnpm build && node scripts/boot-smoke.mjs`)
//   Env: SMOKE_PORT (default 4599), SMOKE_TIMEOUT_MS (default 30000)

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const DIST = fileURLToPath(new URL("../dist", import.meta.url));
const PORT = Number(process.env.SMOKE_PORT ?? 4599);
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 30_000);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

function fail(message) {
  console.error(`\n❌ BOOT-SMOKE FAILED: ${message}`);
  process.exitCode = 1;
}

// The `smoke` npm script runs `pnpm build` first; guard against being run standalone.
if (!existsSync(join(DIST, "index.html"))) {
  console.error(
    `dist/index.html not found at ${DIST}.\n` +
      "Run `pnpm build` first (the `smoke` script does this for you).",
  );
  process.exit(1);
}

// Minimal zero-dependency SPA static server: serve the requested file if it exists,
// otherwise fall back to index.html so client-side routes still boot the app shell.
const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
    let filePath = normalize(join(DIST, urlPath));
    // Path-traversal guard: never serve outside dist/.
    if (filePath !== DIST && !filePath.startsWith(DIST + "/")) {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }
    const info = existsSync(filePath) ? await stat(filePath) : null;
    if (!info || info.isDirectory()) filePath = join(DIST, "index.html");
    const body = await readFile(filePath);
    res.writeHead(200, {
      "content-type": MIME[extname(filePath)] ?? "application/octet-stream",
    });
    res.end(body);
  } catch {
    try {
      res.writeHead(200, { "content-type": MIME[".html"] });
      res.end(await readFile(join(DIST, "index.html")));
    } catch {
      res.writeHead(500);
      res.end("server error");
    }
  }
});

await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${PORT}/`;
console.log(`▶ boot-smoke: serving ${DIST} at ${url}`);

let browser;
try {
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
} catch (error) {
  await new Promise((resolve) => server.close(resolve));
  console.error(
    "Could not launch headless Chromium. Install the browser first:\n" +
      "  pnpm exec playwright install --with-deps chromium\n" +
      `Underlying error: ${error?.message ?? error}`,
  );
  process.exit(1);
}

const page = await browser.newPage();

// Collect uncaught exceptions (the #708 signal) and other boot-time noise.
const pageErrors = [];
page.on("pageerror", (error) => {
  pageErrors.push(error);
  console.error(`  [pageerror] ${error?.stack ?? error?.message ?? error}`);
});
page.on("requestfailed", (request) => {
  const failure = request.failure();
  console.error(`  [requestfailed] ${request.url()} ${failure?.errorText ?? ""}`);
});

let bootError = null;
try {
  const response = await page.goto(url, { waitUntil: "load", timeout: TIMEOUT_MS });
  if (!response || !response.ok()) {
    throw new Error(`initial document did not load ok (status ${response?.status()})`);
  }
  // Wait for the app to actually mount into #root (proves it did not white-screen).
  await page.waitForFunction(
    () => {
      const root = document.getElementById("root");
      if (!root) return false;
      const text = (root.innerText ?? root.textContent ?? "").trim();
      return root.childElementCount > 0 && text.length > 0;
    },
    { timeout: TIMEOUT_MS },
  );
} catch (error) {
  bootError = error;
}

const rootHtmlLength = await page
  .evaluate(() => (document.getElementById("root")?.innerHTML ?? "").length)
  .catch(() => 0);

await browser.close();
await new Promise((resolve) => server.close(resolve));

// Verdict — any of these is a hard failure.
const syntaxErrors = pageErrors.filter(
  (error) =>
    error?.name === "SyntaxError" ||
    /SyntaxError/.test(error?.message ?? "") ||
    /SyntaxError/.test(error?.stack ?? ""),
);

if (pageErrors.length > 0) {
  fail(
    `${pageErrors.length} uncaught page error(s) at boot` +
      (syntaxErrors.length > 0
        ? ` (including ${syntaxErrors.length} SyntaxError — the #708 white-screen class).`
        : "."),
  );
} else if (bootError) {
  fail(
    `#root never became non-empty within ${TIMEOUT_MS}ms (${bootError.message}). ` +
      "The app failed to mount — likely a white screen.",
  );
} else if (rootHtmlLength === 0) {
  fail("#root is empty after load — white screen.");
} else {
  console.log(
    `\n✅ boot-smoke passed: #root mounted (${rootHtmlLength} chars of HTML), 0 uncaught page errors.`,
  );
}

process.exit(process.exitCode ?? 0);
