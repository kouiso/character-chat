import { describe, expect, it } from "vitest";

import { readAssistantText } from "./scenario-runner";

import type { Page } from "playwright";

type Bubble = { className: string; paragraphs: string[]; spans?: string[]; raw?: string };

// Playwright の Page のうち readAssistantText が触る部分だけを作る。
// 実ブラウザを立てずに「待ち文言を本文として返さんか」を確かめるため。
const fakePage = (bubbles: Bubble[]): Page => {
  const listFor = (bubble: Bubble, selector: string): string[] => {
    if (selector === "p") return bubble.paragraphs;
    if (selector === "span.whitespace-pre-wrap") return bubble.spans ?? [];
    return [];
  };
  return {
    locator: () => ({
      count: async () => bubbles.length,
      nth: (index: number) => {
        const bubble = bubbles[index]!;
        return {
          getAttribute: async () => bubble.className,
          locator: (inner: string) => ({
            count: async () => listFor(bubble, inner).length,
            allTextContents: async () => listFor(bubble, inner),
          }),
          textContent: async () => bubble.raw ?? "",
        };
      },
    }),
  } as unknown as Page;
};

const LOADING = "ことばを探している…";

describe("readAssistantText", () => {
  it("返事がまだ来てへん時に待ち文言を本文として返さん", async () => {
    // #899 の採点を壊した状態の再現。この吹き出しには待ち文言しか無い。
    const page = fakePage([
      { className: "bg-gradient-user-bubble", paragraphs: ["もっと"] },
      { className: "her", paragraphs: [LOADING], raw: LOADING },
    ]);
    expect(await readAssistantText(page)).toBe("");
  });

  it("span 側にだけ待ち文言が出た場合も返さん", async () => {
    const page = fakePage([{ className: "her", paragraphs: [], spans: [LOADING], raw: LOADING }]);
    expect(await readAssistantText(page)).toBe("");
  });

  it("実際の返事はそのまま返す", async () => {
    const body = "あら、久しぶり。どう？最近どうしてるの？";
    const page = fakePage([{ className: "her", paragraphs: [body] }]);
    expect(await readAssistantText(page)).toBe(body);
  });

  it("複数段落の返事を連結して返す", async () => {
    const page = fakePage([
      { className: "her", paragraphs: ["彼女は近づいた。", "そして笑った。"] },
    ]);
    expect(await readAssistantText(page)).toBe("彼女は近づいた。 そして笑った。");
  });

  it("直近のユーザー発言は読まん", async () => {
    const page = fakePage([
      { className: "her", paragraphs: ["前の返事。"] },
      { className: "bg-gradient-user-bubble", paragraphs: ["もっと"] },
    ]);
    expect(await readAssistantText(page)).toBe("前の返事。");
  });
});
