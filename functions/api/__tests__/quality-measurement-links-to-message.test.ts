// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { persistServedQualityMeasurement } from "../lib/route-context";

// 品質測定の行は `message_id` が全行 NULL やった。列は在るのに埋める側が 0 件、に見えるが
// 理由は別で、**その時点で id が存在せん**。assistant の行はストリーム中には無く、
// クライアントが採番してストリーム終了後に別リクエストで作る。
// 紐づけが無いと「配信された本文はどの試行か」が追えず、続き書きが効いとるかも分からん
// （2026-08-20 の通読で、長さの原因究明がここで止まった）。

const buildDatabase = () => {
  const values = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn().mockReturnValue({ values });
  return { database: { insert } as never, values };
};

const measurement = {
  phase: "climax" as const,
  variants: [{ slot: "scene_response_structure" as const, id: "variant-1" }],
  judgeRan: false,
  judgePass: false,
  judgeReason: undefined,
  deterministicPass: true,
  deterministicCategory: null,
  failedCheck: null,
};

describe("persistServedQualityMeasurement", () => {
  it("配信された assistant 行の id を測定行へ書く", async () => {
    const { database, values } = buildDatabase();

    await persistServedQualityMeasurement(
      database,
      measurement,
      "<response><action>本文</action></response>",
      "deepseek/deepseek-chat",
      "3f1c9d4a-0000-4000-8000-000000000001",
    );

    const rows = values.mock.calls[0]?.[0] as { messageId: string | null }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].messageId).toBe("3f1c9d4a-0000-4000-8000-000000000001");
  });

  it("id を渡さん経路では今までどおり null で書く", async () => {
    const { database, values } = buildDatabase();

    await persistServedQualityMeasurement(
      database,
      measurement,
      "<response><action>本文</action></response>",
      "deepseek/deepseek-chat",
    );

    const rows = values.mock.calls[0]?.[0] as { messageId: string | null }[];
    expect(rows[0].messageId).toBeNull();
  });
});
