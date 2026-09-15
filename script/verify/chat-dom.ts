import { chromium } from "playwright";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:8789/', { waitUntil: 'domcontentloaded' });
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
  await page.goto('http://127.0.0.1:8789/chat', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const imgs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('img')).map((i) => ({
      alt: i.alt,
      src: i.src,
      currentSrc: i.currentSrc,
      width: i.width,
      height: i.height,
      naturalWidth: i.naturalWidth,
      rectWidth: i.getBoundingClientRect().width,
      rectHeight: i.getBoundingClientRect().height,
      style: `${i.style.cssText};${window.getComputedStyle(i).display};${window.getComputedStyle(i).visibility}`,
    }))
  );
  console.log(JSON.stringify(imgs.slice(0, 20), null, 2));
  await browser.close();
}
main();
