import { execSync, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Browser, BrowserContext } from "playwright";

import {
  isExpectedAnonymousAvatarDenial,
  isExpectedAuthBootstrapFailure,
  isResourceLoadConsoleNoise,
  partitionRequestFailures,
  resolveVerdict,
  type RequestFailure,
} from "./visual-smoke-verdict";

const REPO_ROOT = process.cwd();
const VERIFY_DIR = path.join(REPO_ROOT, ".work", "verify");
const VERIFY_JSON = path.join(VERIFY_DIR, "last-verify.json");
const SCREENSHOTS_DIR = path.join(VERIFY_DIR, "screenshots");
const DEV_PORT = 5173;
const DEV_URL = `http://localhost:${DEV_PORT}`;
// vite.config.ts は /api をこの port の worker へ転送する。
// worker は pnpm dev:worker でしか起動せず、このスモークは起動せん。
const BACKEND_PORT = 8788;

type RouteMapping = {
  pattern: string;
  routes: string[];
};

type VerificationResult = {
  ts: string;
  contentPatchHash: string;
  screenshotPath: string | null;
  routes: string[];
  pageErrors: string[];
  failedRequests: string[];
  verdict: "verified" | "needs_work" | "channel_failure";
  note?: string;
};

const ROUTE_MAP: RouteMapping[] = [
  { pattern: "src/component/chat/", routes: ["/"] },
  { pattern: "src/component/settings/", routes: ["/"] },
  { pattern: "src/app.tsx", routes: ["/"] },
  { pattern: "src/store/", routes: ["/"] },
  { pattern: "src/hook/", routes: ["/"] },
  { pattern: "src/lib/api.ts", routes: ["/"] },
  { pattern: "src/component/", routes: ["/"] },
  { pattern: "prompt/instructions/core.md", routes: ["/"] },
  { pattern: "prompt/instructions/persona.md", routes: ["/"] },
];

const EXCLUSION_PATTERNS = ["drizzle/", ".env", "wrangler.toml", ".d.ts", "type.ts", "types.ts"];

function readCommand(command: string): string {
  try {
    return execSync(command, { encoding: "utf-8" });
  } catch {
    return "";
  }
}

function computeDiffHash(): string {
  // .work/verify/ を除外: ゲート自身が scoreboard.jsonl に追記するため、
  // 含めると検証直後に hash が自己無効化するループになる（stop-gate hook 側と整合必須）
  const exclude = `-- . ':(exclude).work/verify/**'`;
  const diff = readCommand(`git diff HEAD ${exclude} 2>/dev/null`);
  const content = diff.length > 0 ? diff : readCommand(`git diff --cached HEAD ${exclude} 2>/dev/null`);
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function getChangedFiles(): string[] {
  const diff = readCommand("git diff --name-only HEAD 2>/dev/null");
  const cached = readCommand("git diff --cached --name-only 2>/dev/null");
  return [...new Set([...diff.split("\n"), ...cached.split("\n")].filter(Boolean))].sort();
}

function shouldSkip(files: string[]): boolean {
  if (files.length === 0) return true;
  return files.every((file) => EXCLUSION_PATTERNS.some((excluded) => file.includes(excluded)));
}

function getRoutesToVerify(files: string[]): string[] {
  const routes = new Set<string>();
  for (const file of files) {
    for (const { pattern, routes: mappedRoutes } of ROUTE_MAP) {
      if (file.includes(pattern)) {
        mappedRoutes.forEach((route) => routes.add(route));
      }
    }
  }
  if (routes.size === 0) routes.add("/");
  return [...routes];
}

async function isDevServerRunning(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${port}`, { signal: AbortSignal.timeout(2_000) });
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

async function waitForDevServer(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isDevServerRunning(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return false;
}

async function ensureDevServer(): Promise<ChildProcess | null> {
  if (await isDevServerRunning(DEV_PORT)) return null;

  console.log(`[verify:visual] Dev server not running on port ${DEV_PORT}. Starting pnpm dev...`);
  const server = spawn("pnpm", ["dev", "--host", "127.0.0.1"], {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  server.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (text) console.log(`[verify:visual:dev] ${text}`);
  });
  server.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (text) console.error(`[verify:visual:dev] ${text}`);
  });

  const ready = await waitForDevServer(DEV_PORT, 30_000);
  if (!ready) {
    server.kill("SIGTERM");
    throw new Error(`Dev server did not become ready on ${DEV_URL} within 30s.`);
  }
  return server;
}

async function launchBrowser(): Promise<Browser> {
  try {
    const playwright = await import("playwright");
    return await playwright.chromium.launch({ headless: true });
  } catch (error) {
    throw new Error(`Playwright chromium could not start. Run 'pnpm install' and 'pnpm exec playwright install chromium'. ${error}`);
  }
}

function writeResult(result: VerificationResult): void {
  writeFileSync(VERIFY_JSON, JSON.stringify(result, null, 2));
}

async function verifyRoutes(context: BrowserContext, routes: string[], ts: string): Promise<{
  pageErrors: string[];
  failedRequests: RequestFailure[];
  screenshots: string[];
}> {
  const pageErrors: string[] = [];
  const failedRequests: RequestFailure[] = [];
  const screenshots: string[] = [];

  for (const route of routes) {
    const url = `${DEV_URL}${route}`;
    const page = await context.newPage();

    page.on("pageerror", (error) => {
      pageErrors.push(error.message);
    });
    page.on("requestfailed", (request) => {
      failedRequests.push({
        url: request.url(),
        detail: request.failure()?.errorText ?? "requestfailed",
      });
    });
    page.on("response", (response) => {
      const status = response.status();
      if (status < 400) return;
      if (isExpectedAnonymousAvatarDenial(response.url(), status)) return;
      if (isExpectedAuthBootstrapFailure(response.url(), status)) return;
      failedRequests.push({ url: response.url(), detail: String(status) });
    });
    page.on("console", (message) => {
      if (message.type() === "error" && !isResourceLoadConsoleNoise(message.text())) {
        pageErrors.push(`console.error: ${message.text()}`);
      }
    });

    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
      await page.waitForTimeout(2_000);

      const safeTimestamp = ts.replaceAll(/[:.]/g, "-");
      const safeRoute = route.replaceAll("/", "_") || "root";
      const screenshotPath = path.join(SCREENSHOTS_DIR, `verify-${safeTimestamp}-${safeRoute}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false });
      screenshots.push(screenshotPath);
      console.log(`[verify:visual] Screenshot: ${screenshotPath}`);
    } catch (error) {
      pageErrors.push(`Navigation error: ${String(error)}`);
    } finally {
      await page.close();
    }
  }

  return { pageErrors, failedRequests, screenshots };
}

async function main(): Promise<number> {
  mkdirSync(VERIFY_DIR, { recursive: true });
  mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  const ts = new Date().toISOString();
  const diffHash = computeDiffHash();
  const changedFiles = getChangedFiles();

  console.log(`[verify:visual] Changed files: ${changedFiles.join(", ") || "(none)"}`);
  console.log(`[verify:visual] Content patch hash: ${diffHash}`);

  if (shouldSkip(changedFiles)) {
    console.log("[verify:visual] No UI-affecting changes detected. Skipping.");
    writeResult({
      ts,
      contentPatchHash: diffHash,
      screenshotPath: null,
      routes: [],
      pageErrors: [],
      failedRequests: [],
      verdict: "verified",
      note: "No UI-affecting changes",
    });
    return 0;
  }

  const routes = getRoutesToVerify(changedFiles);
  console.log(`[verify:visual] Routes to verify: ${routes.join(", ")}`);

  let devServer: ChildProcess | null = null;
  let browser: Browser | null = null;

  try {
    devServer = await ensureDevServer();
    browser = await launchBrowser();
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const { pageErrors, failedRequests, screenshots } = await verifyRoutes(context, routes, ts);
    await context.close();

    const screenshotPath = screenshots[0] ?? null;
    const backendReachable = await isDevServerRunning(BACKEND_PORT);
    const { uiDefects, backendUnavailable } = partitionRequestFailures(
      failedRequests,
      backendReachable,
    );
    const verdict = resolveVerdict({
      pageErrors,
      uiDefects,
      backendUnavailable,
      screenshotExists: Boolean(screenshotPath) && existsSync(screenshotPath ?? ""),
    });

    if (backendUnavailable.length > 0) {
      console.error(
        `[verify:visual] Backend on port ${BACKEND_PORT} is unreachable. UI cannot be judged.`,
      );
      console.error("[verify:visual] Start it with 'pnpm dev:worker' and re-run.");
      backendUnavailable.forEach((request) =>
        console.error(`  - ${request.detail} ${request.url}`),
      );
    } else if (pageErrors.length > 0 || uiDefects.length > 0) {
      console.error("[verify:visual] Page errors detected:");
      pageErrors.forEach((error) => console.error(`  - ${error}`));
      // console.error のリソース読み込みノイズを除外した代わりに、
      // URL つきで拾った 4xx/5xx をここで不合格に効かせる（除外分だけ穴が空くのを防ぐ）。
      uiDefects.forEach((request) => console.error(`  - ${request.detail} ${request.url}`));
    }

    writeResult({
      ts,
      contentPatchHash: diffHash,
      screenshotPath,
      routes,
      pageErrors,
      failedRequests: failedRequests.map((request) => `${request.detail} ${request.url}`),
      verdict,
    });
    console.log(`[verify:visual] Verdict: ${verdict}`);
    console.log(`[verify:visual] Evidence written: ${VERIFY_JSON}`);

    if (verdict === "verified") {
      console.log("✅ Visual verification passed.");
      return 0;
    }
    console.error("❌ Visual verification FAILED. Fix issues before declaring done.");
    return 1;
  } catch (error) {
    const result: VerificationResult = {
      ts,
      contentPatchHash: diffHash,
      screenshotPath: null,
      routes,
      pageErrors: [String(error)],
      failedRequests: [],
      verdict: "channel_failure",
    };
    writeResult(result);
    console.error("[verify:visual] Fatal error:", error);
    return 1;
  } finally {
    if (browser) await browser.close();
    if (devServer) devServer.kill("SIGTERM");
  }
}

void main().then((exitCode) => {
  process.exitCode = exitCode;
});
