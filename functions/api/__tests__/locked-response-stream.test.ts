import { afterEach, describe, expect, it, vi } from "vitest";

import { requestOpenRouterChat } from "../[[route]]";

// 1トークン目が来んかった候補の Response は、既に getReader() でロック済み。
// それを lastResponse として上流へ返すと、本文を読んだ時点で
// "This ReadableStream is currently locked to a reader" で落ち、クライアントへ 502 が出る。
// 上流が読める Response だけを返す、という不変条件の回帰テスト。

const sseWithoutContentToken = () =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      // ロール宣言だけで content が1文字も無いまま閉じる、実際に観測された形。
      controller.enqueue(
        new TextEncoder().encode('data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n'),
      );
      controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestOpenRouterChat: 1トークン目が無い候補の後始末", () => {
  it("全候補が本文を返さんかった時、上流へ渡す Response の本文が読める", async () => {
    vi.stubGlobal("fetch", async () => new Response(sseWithoutContentToken(), { status: 200 }));

    const result = await requestOpenRouterChat(
      "test-key",
      "https://example.test",
      "test/model",
      "conversation",
      [{ role: "user", content: "こんにちは" }],
      undefined,
      undefined,
      true,
    );

    // ここが本題。修正前はロック済み body が返り、この行が TypeError で落ちた。
    await expect(result.response.text()).resolves.toBeTypeOf("string");
  });

  it("本文が1文字も来んかったら、空の成功やのうて 503 として返す", async () => {
    vi.stubGlobal("fetch", async () => new Response(sseWithoutContentToken(), { status: 200 }));

    const result = await requestOpenRouterChat(
      "test-key",
      "https://example.test",
      "test/model",
      "conversation",
      [{ role: "user", content: "こんにちは" }],
      undefined,
      undefined,
      true,
    );

    expect(result.response.status).toBe(503);
  });

  it("本文が来た候補はそのまま中継する", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode('data: {"choices":[{"delta":{"content":"あ"}}]}\n\n'),
              );
              controller.close();
            },
          }),
          { status: 200 },
        ),
    );

    const result = await requestOpenRouterChat(
      "test-key",
      "https://example.test",
      "test/model",
      "conversation",
      [{ role: "user", content: "こんにちは" }],
      undefined,
      undefined,
      true,
    );

    expect(result.response.status).toBe(200);
    await expect(result.response.text()).resolves.toContain("あ");
  });
});
