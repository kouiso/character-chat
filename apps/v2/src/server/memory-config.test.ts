// @vitest-environment node
import { readFileSync } from "node:fs";

import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const queueSchema = z.object({
  producers: z.array(z.object({ binding: z.string(), queue: z.string() })),
  consumers: z.array(z.object({ queue: z.string() })),
});

describe("記憶処理の環境境界", () => {
  it("通常環境は抽出を起動せず、rag環境だけがQueueを持つ", () => {
    const source = readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8");
    const parsed = ts.parseConfigFileTextToJson("wrangler.jsonc", source);
    expect(parsed.error).toBeUndefined();
    const config = z
      .object({
        queues: z.never().optional(),
        vars: z.object({ V2_RAG_ENABLED: z.literal("0") }),
        env: z.object({
          rag: z.object({
            vars: z.object({ V2_RAG_ENABLED: z.literal("1") }),
            queues: queueSchema,
          }),
        }),
      })
      .parse(parsed.config);
    expect(config.env.rag.queues.producers).toEqual([
      { binding: "MEMORY_QUEUE", queue: "adult-ai-v2-memory" },
    ]);
    expect(config.env.rag.queues.consumers).toEqual([{ queue: "adult-ai-v2-memory" }]);
  });
});
