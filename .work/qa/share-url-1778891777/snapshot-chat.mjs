import { chromium } from "playwright";

const url = process.env.URL ?? "http://localhost:5173/#/chat/char-share-1";
const out = process.env.OUT ?? ".work/qa/share-url-1778891777/iphone-share-button.png";
const token = process.env.AUTH_TOKEN ?? "devtoken-share-url";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
await page.addInitScript(
  ({ token }) => {
    window.localStorage.setItem("auth_token", token);
    window.localStorage.setItem(
      "age_verified",
      JSON.stringify({ verified: true, timestamp: Date.now() }),
    );
  },
  { token },
);
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
await page.screenshot({ path: out, fullPage: false });
await browser.close();
console.log("wrote", out);
