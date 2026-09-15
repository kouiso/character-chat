import { afterEach, describe, expect, it } from "vitest";

import { watchBackgrounded } from "./background-interruption";

const setVisibility = (state: "visible" | "hidden") => {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
};

afterEach(() => {
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});

describe("watchBackgrounded", () => {
  it("前面のままなら背面判定は立たん", () => {
    const watch = watchBackgrounded();
    expect(watch.wasBackgrounded()).toBe(false);
    watch.stop();
  });

  it("送信の最中に背面へ回ったら覚える", () => {
    const watch = watchBackgrounded();
    setVisibility("hidden");
    expect(watch.wasBackgrounded()).toBe(true);
    watch.stop();
  });

  // 戻ってきた時点で判定を降ろすと、失敗が画面へ届く頃には常に「前面」になっとって
  // 背面で切られた送信を一件も拾えん。
  it("前面へ戻っても、背面へ回った事実は消えん", () => {
    const watch = watchBackgrounded();
    setVisibility("hidden");
    setVisibility("visible");
    expect(watch.wasBackgrounded()).toBe(true);
    watch.stop();
  });

  it("最初から背面で始めた送信も背面扱いにする", () => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    const watch = watchBackgrounded();
    expect(watch.wasBackgrounded()).toBe(true);
    watch.stop();
  });

  it("stop したら以後の背面遷移を拾わん", () => {
    const watch = watchBackgrounded();
    watch.stop();
    setVisibility("hidden");
    expect(watch.wasBackgrounded()).toBe(false);
  });
});
