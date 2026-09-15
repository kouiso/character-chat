import { chromium } from "playwright";

import type { E2eEnv } from "./env";
import type { Browser, BrowserContext } from "playwright";

export type E2eBrowser = {
  browser: Browser;
  connectedAt: string;
  cdpPort: number;
  mode: "cdp" | "launch";
};

const DEFAULT_VIEWPORT = {
  width: 1280,
  height: 900,
} as const;

const shouldRunHeadless = (): boolean => process.env.E2E_HEADLESS !== "false";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export const connectBrowser = async (env: E2eEnv): Promise<E2eBrowser> => {
  // macOS では localhost が ::1 (IPv6) に解決されるが Chrome は 127.0.0.1 のみリッスンするため明示指定
  const endpoint = `http://127.0.0.1:${env.cdpPort}`;
  console.error(`[browser] connect cdp=${endpoint}`);

  try {
    // CDP 接続タイムアウトを 5s に短縮（接続失敗時の待機を最小化）
    const browser = await chromium.connectOverCDP(endpoint, { timeout: 5_000 });
    browser.on("disconnected", () => {
      console.error(`[browser] disconnected cdp=${endpoint}`);
    });

    return {
      browser,
      connectedAt: new Date().toISOString(),
      cdpPort: env.cdpPort,
      mode: "cdp",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[browser] cdp unavailable, falling back to local launch: ${message}`);
    const headless = shouldRunHeadless();
    console.error(`[browser] local launch headless=${headless}`);
    // WSL2 で chrome-headless-shell が SIGTRAP でクラッシュする問題を回避する場合は
    // E2E_BROWSER_EXECUTABLE に system の Google Chrome パスを渡す。
    const chromePath = process.env.E2E_BROWSER_EXECUTABLE;
    const baseArgs = [
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
    ];
    const browser = await chromium.launch(
      chromePath
        ? { headless, executablePath: chromePath, args: baseArgs }
        : { headless, args: baseArgs },
    );
    browser.on("disconnected", () => {
      console.error("[browser] disconnected local-launch");
    });
    return {
      browser,
      connectedAt: new Date().toISOString(),
      cdpPort: env.cdpPort,
      mode: "launch",
    };
  }
};

export const createContext = async (browser: Browser): Promise<BrowserContext> =>
  browser.newContext({
    locale: "ja-JP",
    viewport: DEFAULT_VIEWPORT,
    // VitePWA の autoUpdate がテスト中にSWを更新してページをリロードするのを防ぐ
    serviceWorkers: "block",
  });

export const closeContext = async (ctx: BrowserContext): Promise<void> => {
  await ctx.close();
};

export const heartbeat = async (browser: Browser): Promise<boolean> => browser.isConnected();

export const staggeredDelay = async (index: number, stepSeconds: number): Promise<void> => {
  const delayMs = Math.max(0, index) * Math.max(0, stepSeconds) * 1000;
  await sleep(delayMs);
};
