import { describe, expect, it, vi } from "vitest";

import { createRestAi } from "./workers-ai-rest";

describe("workers-ai rest wrapper", () => {
  it("URL・Authorization・返り値の result 展開が期待どおり", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, result: { data: [[0.1]] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const ai = createRestAi({ accountId: "acct-1", apiToken: "token-2", fetchImpl });
    const result = (await ai.run(
      "@cf/baai/bge-m3" as never,
      {
        text: ["紅茶"],
        truncate_inputs: false,
      } as never,
    )) as { data: number[][] };
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/accounts/acct-1/ai/run/@cf/baai/bge-m3",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer token-2" }),
      }),
    );
    expect(result.data).toEqual([[0.1]]);
  });

  it("success:false や HTTP 失敗は投げる", async () => {
    const failing = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: false, errors: [{ message: "bad" }] }), {
        status: 500,
      }),
    );
    const ai = createRestAi({ accountId: "a", apiToken: "t", fetchImpl: failing });
    await expect(ai.run("m" as never, {} as never)).rejects.toThrow();
  });
});
