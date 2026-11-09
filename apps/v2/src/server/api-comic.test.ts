// RIT-189: 4コマ漫画 API の面の確かめ — Body の validation、groupId+panelIndex の
// セット制約、コマごとの成否の返し方、全部失敗の 502 を見る。
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as ImageGen from "./image-generation";

const platform = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
const comic = vi.hoisted(() => vi.fn());

vi.mock("./platform", () => ({ getPlatform: async () => platform }));
vi.mock("./image-generation", async (importOriginal) => ({
  ...(await importOriginal<typeof ImageGen>()),
  generateConversationComic: comic,
}));

const { handleComicRequest } = await import("./api-images");

const post = (body: Record<string, unknown>) =>
  handleComicRequest(
    "char-1",
    new Request("https://example.com/api/chat/char-1/comic", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );

const okPanels = () =>
  [0, 1, 2, 3].map((panelIndex) => ({
    panelIndex,
    ok: true as const,
    messageId: `m${panelIndex}`,
    imageUrl: `/api/media/m${panelIndex}`,
    generationId: `g${panelIndex}`,
  }));

describe("handleComicRequest", () => {
  beforeEach(() => {
    comic.mockReset();
    comic.mockResolvedValue({ ok: true, groupId: "grp", panels: okPanels() });
  });

  it("conversationId を生成呼び出しへ渡し、4コマの結果を返す", async () => {
    const response = await post({ conversationId: "conv-1" });
    expect(response.status).toBe(200);
    expect(comic).toHaveBeenCalledWith({
      env: platform.env,
      characterId: "char-1",
      conversationId: "conv-1",
      groupId: undefined,
      panelIndex: undefined,
    });
    const body: {
      groupId: string;
      panels: { panelIndex: number; ok: boolean; message?: string }[];
    } = await response.json();
    expect(body.groupId).toBe("grp");
    expect(body.panels).toHaveLength(4);
  });

  it("groupId+panelIndex はコマ単位の再生成としてそのまま渡る", async () => {
    comic.mockResolvedValue({
      ok: true,
      groupId: "grp-9",
      panels: [
        {
          panelIndex: 2,
          ok: true,
          messageId: "m2",
          imageUrl: "/api/media/m2",
          generationId: "g2",
        },
      ],
    });
    const response = await post({ conversationId: "conv-1", groupId: "grp-9", panelIndex: 2 });
    expect(response.status).toBe(200);
    expect(comic).toHaveBeenCalledWith({
      env: platform.env,
      characterId: "char-1",
      conversationId: "conv-1",
      groupId: "grp-9",
      panelIndex: 2,
    });
  });

  it.each([
    ["groupId だけ", { groupId: "grp-9" }],
    ["panelIndex だけ", { panelIndex: 1 }],
    ["panelIndex 範囲外", { groupId: "grp-9", panelIndex: 4 }],
    ["panelIndex 負数", { groupId: "grp-9", panelIndex: -1 }],
    ["conversationId 空", { conversationId: "" }],
  ])("異常値は 400: %s", async (_label, extra) => {
    const response = await post({ conversationId: "conv-1", ...extra });
    expect(response.status).toBe(400);
    expect(comic).not.toHaveBeenCalled();
  });

  it("一部コマの失敗は 200 のまま panels に載る", async () => {
    const panels = okPanels();
    comic.mockResolvedValue({
      ok: true,
      groupId: "grp",
      panels: [
        panels[0],
        { panelIndex: 1, ok: false, generationId: "g1", status: 502, message: "生成失敗" },
        panels[2],
        panels[3],
      ],
    });
    const response = await post({ conversationId: "conv-1" });
    expect(response.status).toBe(200);
    const body: {
      panels: { panelIndex: number; ok: boolean; message?: string }[];
    } = await response.json();
    expect(body.panels[1].ok).toBe(false);
    expect(body.panels[1].message).toBe("生成失敗");
  });

  it("全部落ちた時だけ 502", async () => {
    comic.mockResolvedValue({
      ok: false,
      groupId: "grp",
      panels: [0, 1, 2, 3].map((panelIndex) => ({
        panelIndex,
        ok: false,
        generationId: `g${panelIndex}`,
        status: 502,
        message: "生成失敗",
      })),
    });
    const response = await post({ conversationId: "conv-1" });
    expect(response.status).toBe(502);
  });
});
