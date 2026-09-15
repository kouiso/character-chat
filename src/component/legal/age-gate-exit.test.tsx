import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 年齢ゲートの出入りだけを見たいので、メイン画面側の重い依存は差し替える
vi.mock("@/component/ouse", () => ({ OuApp: () => <div data-testid="ou-app" /> }));
vi.mock("@/component/ouse/ou-onboarding", () => ({ OuOnboarding: () => null }));
vi.mock("@/component/settings/settings-panel", () => ({ SettingsPanel: () => null }));
vi.mock("@/component/pwa/pwa-update-banner", () => ({ PwaUpdateBanner: () => null }));

import { App } from "@/app";

const goTo = (path: string) => {
  window.history.pushState(null, "", path);
};

describe("年齢確認の行き止まり", () => {
  beforeEach(() => {
    window.localStorage.clear();
    goTo("/");
  });
  afterEach(cleanup);

  // 退出後に無操作の黒画面を残すと、URL 欄の無い PWA では消す以外に手が無い
  it("「いいえ、退出します」の後も言葉と戻る道が残る", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "いいえ、退出します" }));

    expect(screen.getByText(/18 歳以上の方のみ/u)).toBeInTheDocument();
    const back = screen.getByRole("button", { name: "年齢確認へ戻る" });

    fireEvent.click(back);

    expect(screen.getByRole("button", { name: "はい、18歳以上です" })).toBeInTheDocument();
  });

  // 同意を求めとる文章に到達でけへんのは、それ自体が行き止まり
  it("利用規約はゲートに覆われず読める", () => {
    goTo("/legal/tos");

    render(<App />);

    expect(screen.getByText("第1条（適用）")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "はい、18歳以上です" })).toBeNull();
  });
});
