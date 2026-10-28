// @vitest-environment node
import { describe, expect, it } from "vitest";

import { handleMemoryJobBatch, MEMORY_JOB_KINDS, parseMemoryJob } from "./memory-jobs";

const message = (body: unknown) => {
  const calls: string[] = [];
  return {
    body,
    calls,
    ack: () => calls.push("ack"),
    retry: () => calls.push("retry"),
  };
};

describe("Queue の記憶仕事の受け手", () => {
  it.each(MEMORY_JOB_KINDS)("整った封筒 %s を受け取る", (kind) => {
    const job = parseMemoryJob({ kind, characterId: "char-1", conversationId: "conv-1", turn: 3 });
    expect(job).toEqual({ kind, characterId: "char-1", conversationId: "conv-1", turn: 3 });
  });

  it.each([
    undefined,
    null,
    "text",
    {},
    { kind: "extract-facts" },
    { kind: "unknown-kind", characterId: "c", conversationId: "v" },
    { kind: "embed-memory", characterId: "", conversationId: "v" },
    { kind: "embed-memory", characterId: "c", conversationId: "" },
    { kind: "summarize-window", characterId: "c", conversationId: "v", turn: -1 },
    { kind: "summarize-window", characterId: "c", conversationId: "v", turn: 1.5 },
  ])("形の合わん仕事は退ける: %j", (body) => {
    expect(parseMemoryJob(body)).toBeNull();
  });

  it("整った仕事は ack、壊れた仕事は再送せず ack、他の仕事を巻き込まん", async () => {
    const good = message({ kind: "extract-facts", characterId: "c", conversationId: "v" });
    const broken = message({ kind: "embed-memory" });
    const alsoGood = message({
      kind: "summarize-window",
      characterId: "c2",
      conversationId: "v2",
      turn: 0,
    });
    await handleMemoryJobBatch({ messages: [good, broken, alsoGood] });
    expect(good.calls).toEqual(["ack"]);
    expect(broken.calls).toEqual(["ack"]);
    expect(alsoGood.calls).toEqual(["ack"]);
  });
});
