import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { ChatMessage } from "@/store/chat-store";

import { HerMessage } from "./her-message";

const withBody = (extra: Partial<ChatMessage>): ChatMessage => ({
  id: "msg-rewrite",
  role: "assistant",
  content: "<response><dialogue>「さっきの返事」</dialogue></response>",
  ...extra,
});

describe("HerMessage 書き直し中の印", () => {
  afterEach(cleanup);

  // 撮り直し中は本文を消さずに旧本文を出したままにする。何も印を出さんと
  // 画面が止まって見えて、故障と区別が付かん。
  it("書き直し中は本文を残したまま進行中の印を出す", async () => {
    render(<HerMessage message={withBody({ isRegenerating: true })} isStreaming={true} />);

    // 段階表示は台詞層まで 1.7 秒ほど遅らせるので、既定の 1 秒では届かん
    expect(await screen.findByText("「さっきの返事」", undefined, { timeout: 4000 })).toBeTruthy();
    expect(screen.getByText(/ことばを選びなおしている/)).toBeTruthy();
  });

  // isRegenerating は「撮り直しを経た返事」の印としても onComplete が立てる。
  // 流れ終わった後も出しっぱなしにすると、完成した返事に脈打つ表示が残る。
  it("流れ終わった返事には印を出さん", () => {
    render(<HerMessage message={withBody({ isRegenerating: true })} isStreaming={false} />);

    expect(screen.getByText("「さっきの返事」")).toBeTruthy();
    expect(screen.queryByText(/ことばを選びなおしている/)).toBeNull();
  });

  it("書き直しとらん時は印を出さん", () => {
    render(<HerMessage message={withBody({})} isStreaming={true} />);

    expect(screen.queryByText(/ことばを選びなおしている/)).toBeNull();
  });
});
