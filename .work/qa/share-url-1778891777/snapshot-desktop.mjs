import { chromium } from "playwright";

const out = process.env.OUT ?? ".work/qa/share-url-1778891777/desktop-share-button.png";
const token = process.env.AUTH_TOKEN ?? "devtoken-share-url";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
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
await page.goto("http://localhost:5173/#/chat/char-share-1", { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
// 既存会話を選択して currentConversationId をセット → Share ボタンが活性化する
const convLink = page.locator("text=テスト会話").first();
if ((await convLink.count()) > 0) {
  await convLink.click();
  await page.waitForTimeout(1200);
}
await page.screenshot({ path: out, fullPage: false });
await browser.close();
console.log("wrote", out);
