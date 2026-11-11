// 本番の任意ページをサービストークン経由で開いてスクリーンショットする。
// 使い方: pnpm exec tsx script/verify/prod-shot.ts "/chat/xxx" [out.png] [--mobile]
// 認証情報は .prod-verify.vars の CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET。

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

// WSL ではシステムの nss ライブラリが無く headless Chromium が起動できない。
// sudo 不要で ~/.local/pw-libs に apt 展開済みのものがあれば差し込む。
const localPwLibs = path.join(
  process.env.HOME ?? "",
  ".local/pw-libs/root/usr/lib/x86_64-linux-gnu",
);
if (existsSync(localPwLibs)) {
  process.env.LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH
    ? `${localPwLibs}:${process.env.LD_LIBRARY_PATH}`
    : localPwLibs;
}

const loadProdVars = (): Record<string, string> => {
  const varsPath = path.resolve(".prod-verify.vars");
  const result: Record<string, string> = {};
  for (const line of readFileSync(varsPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    result[trimmed.slice(0, eq).trim()] = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return result;
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const targetPath = args[0] ?? "/";
  const outArg = args.find((a) => a.endsWith(".png") || a.endsWith(".jpg"));
  const mobile = args.includes("--mobile");
  const fullPage = args.includes("--full");

  const vars = loadProdVars();
  const base = vars["PROD_BASE_URL"] ?? "https://adult-ai-chat.pages.dev";
  const prodOrigin = new URL(base).origin;
  const cfHeaders: Record<string, string> = {};
  if (vars["CF_ACCESS_CLIENT_ID"] && vars["CF_ACCESS_CLIENT_SECRET"]) {
    cfHeaders["CF-Access-Client-Id"] = vars["CF_ACCESS_CLIENT_ID"];
    cfHeaders["CF-Access-Client-Secret"] = vars["CF_ACCESS_CLIENT_SECRET"];
  }

  const outDir = path.resolve(".work", "e2e-results");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const out = outArg ?? path.join(outDir, `prod-shot-${Date.now()}.png`);

  const playwright = await import("playwright");
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext(
    mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : undefined,
  );
  const page = await context.newPage();

  // サービストークンは prod origin 限定で注入する（外部 origin へ漏らさない）。
  await page.route("**/*", async (route) => {
    const req = route.request();
    try {
      if (new URL(req.url()).origin !== prodOrigin) {
        await route.continue();
        return;
      }
    } catch {
      await route.continue();
      return;
    }
    await route.continue({ headers: { ...req.headers(), ...cfHeaders } });
  });

  const url = targetPath.startsWith("http") ? targetPath : `${base}${targetPath}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(4_000);
  await page.screenshot({ path: out, fullPage });
  console.log(`saved: ${out} (${page.url()})`);
  await browser.close();
};

await main();
