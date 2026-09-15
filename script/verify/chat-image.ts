import { chromium } from "playwright";

const BASE_URL = process.env["BASE_URL"] ?? "http://127.0.0.1:8789";
const OUT = process.env["OUT"] ?? ".work/ux-screenshots/chat-image.png";
const CONVERSATION_ID = process.env["CONVERSATION_ID"];

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await context.newPage();

  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.setItem("age_verified", JSON.stringify({ verified: true, timestamp: Date.now() }));
    localStorage.setItem("ou_onboarded", "1");
    localStorage.setItem("ai-chat-settings", JSON.stringify({
      state: {
        model: "sao10k/l3.3-euryale-70b",
        nsfwBlur: false,
        darkMode: true,
        autoGenerateImages: false,
        autoExtractMemories: false,
        ttsEnabled: false,
        ttsVoiceUri: "",
        ttsRate: 1,
        ttsPitch: 1,
        activeCharacterId: "char-mitsuki",
        userProfile: "",
        userRole: "",
        responseLength: "long",
        imageProvider: "novita",
      },
      version: 30,
    }));
  });

  const route = CONVERSATION_ID
    ? `/chat?conv=${encodeURIComponent(CONVERSATION_ID)}`
    : "/chat";
  await page.goto(`${BASE_URL}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  const imgs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('img')).map((i) => ({
      alt: i.alt,
      currentSrc: i.currentSrc,
      rectWidth: i.getBoundingClientRect().width,
      rectHeight: i.getBoundingClientRect().height,
    }))
  );
  console.log(JSON.stringify(imgs.slice(-10), null, 2));

  await page.screenshot({ path: OUT, fullPage: false });
  console.log(`[chat-image] ${OUT}`);

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
