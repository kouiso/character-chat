import { describe, expect, it } from "vitest";

import type { ChatMessage } from "@/store/chat-store";

import { pickAutoRetryTarget } from "./auto-retry-target";

const user = (id: string, extra: Partial<ChatMessage> = {}): ChatMessage =>
  ({ id, role: "user", content: id, ...extra }) as ChatMessage;

describe("pickAutoRetryTarget", () => {
  it("何も積まれてへんなら選ばん", () => {
    expect(pickAutoRetryTarget([user("a"), user("b", { sendFailed: true })])).toBeUndefined();
  });

  it("オフラインで積んだものは今までどおり拾う", () => {
    expect(pickAutoRetryTarget([user("a"), user("b", { offlineQueued: true })])?.id).toBe("b");
  });

  // 局長 2026-08-19「押しても再送信しない」。返事待ちの最中に押した意思を残して、
  // 明けた時にこの機構へ拾わせる。
  it("押された再送の意思を拾う", () => {
    expect(pickAutoRetryTarget([user("a"), user("b", { retryRequested: true })])?.id).toBe("b");
  });

  it("古い方から 1 件ずつ", () => {
    expect(
      pickAutoRetryTarget([user("a", { retryRequested: true }), user("b", { offlineQueued: true })])
        ?.id,
    ).toBe("a");
  });

  it("キャラの発言は拾わん", () => {
    expect(
      pickAutoRetryTarget([{ id: "x", role: "assistant", content: "x" } as ChatMessage]),
    ).toBeUndefined();
  });
});
