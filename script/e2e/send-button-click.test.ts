import { afterEach, describe, expect, it } from "vitest";

import { clickSendIfEnabledInPage } from "./send-button-click";

const SELECTOR = "[data-testid='send-button']";

type SetupOptions = {
  disabled?: boolean;
  /** getBoundingClientRect が返す矩形。潰れた矩形は「表示されていない」を表す。 */
  rect?: { left: number; top: number; width: number; height: number };
  /** 中心の座標にいる要素。null なら誰もいない、button 以外なら覆われている。 */
  hitAtCentre?: "button" | "child" | "overlay" | "none";
};

const setup = (options: SetupOptions = {}) => {
  const rect = options.rect ?? { left: 100, top: 200, width: 40, height: 20 };
  const button = document.createElement("button");
  button.setAttribute("data-testid", "send-button");
  button.disabled = options.disabled === true;
  const child = document.createElement("span");
  button.appendChild(child);
  const overlay = document.createElement("div");
  document.body.append(button, overlay);

  // jsdom はレイアウトを持たないため、矩形と当たり判定は差し込む。
  button.getBoundingClientRect = () =>
    ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height }) as DOMRect;

  const hits: Record<string, Element | null> = {
    button,
    child,
    overlay,
    none: null,
  };
  document.elementFromPoint = () => hits[options.hitAtCentre ?? "button"];

  let clicks = 0;
  button.addEventListener("click", () => {
    clicks += 1;
  });

  return { clicks: () => clicks };
};

const GROUP_SELECTOR = "[data-testid='message-group']";

const addRenderedGroups = (count: number): void => {
  for (let i = 0; i < count; i += 1) {
    const group = document.createElement("div");
    group.setAttribute("data-testid", "message-group");
    document.body.append(group);
  }
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("clickSendIfEnabledInPage", () => {
  it("clicks when the button is enabled and the centre hits itself", () => {
    const harness = setup();
    expect(clickSendIfEnabledInPage([SELECTOR, GROUP_SELECTOR]).clicked).toBe(true);
    expect(harness.clicks()).toBe(1);
  });

  it("clicks when the centre hits a descendant of the button", () => {
    const harness = setup({ hitAtCentre: "child" });
    expect(clickSendIfEnabledInPage([SELECTOR, GROUP_SELECTOR]).clicked).toBe(true);
    expect(harness.clicks()).toBe(1);
  });

  // DOM の element.click() は Playwright の force click と同じくヒットテストを飛ばす。
  // 覆われたまま発火させると、実利用ならオーバーレイに吸われる click を「送れた」と読む。
  it("does not click when an overlay covers the button", () => {
    const harness = setup({ hitAtCentre: "overlay" });
    expect(clickSendIfEnabledInPage([SELECTOR, GROUP_SELECTOR]).clicked).toBe(false);
    expect(harness.clicks()).toBe(0);
  });

  it("does not click when the centre hits nothing at all", () => {
    const harness = setup({ hitAtCentre: "none" });
    expect(clickSendIfEnabledInPage([SELECTOR, GROUP_SELECTOR]).clicked).toBe(false);
    expect(harness.clicks()).toBe(0);
  });

  it("does not click when the button has no visible box", () => {
    const harness = setup({ rect: { left: 0, top: 0, width: 0, height: 0 } });
    expect(clickSendIfEnabledInPage([SELECTOR, GROUP_SELECTOR]).clicked).toBe(false);
    expect(harness.clicks()).toBe(0);
  });

  it("does not click while the button is disabled", () => {
    const harness = setup({ disabled: true });
    expect(clickSendIfEnabledInPage([SELECTOR, GROUP_SELECTOR]).clicked).toBe(false);
    expect(harness.clicks()).toBe(0);
  });

  it("returns false when the button is not in the page", () => {
    expect(clickSendIfEnabledInPage([SELECTOR, GROUP_SELECTOR]).clicked).toBe(false);
  });

  // click の可否に関わらず、renderedMessageCount は同じタスク内で読んだ数を返す。
  // 呼び出し側はこの数を「click 直前」の基準として使う。
  it("returns the rendered count from the same task, whether or not it clicked", () => {
    setup();
    addRenderedGroups(3);
    expect(clickSendIfEnabledInPage([SELECTOR, GROUP_SELECTOR]).renderedMessageCount).toBe(3);
  });

  it("returns the rendered count even when the click is blocked", () => {
    setup({ hitAtCentre: "overlay" });
    addRenderedGroups(2);
    const result = clickSendIfEnabledInPage([SELECTOR, GROUP_SELECTOR]);
    expect(result.clicked).toBe(false);
    expect(result.renderedMessageCount).toBe(2);
  });
});
