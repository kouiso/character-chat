import { describe, expect, it, vi } from "vitest";

import {
  embedMemoryText,
  memoryNamespace,
  memoryVectorId,
  validateMemoryVector,
} from "./memory-vector";

describe("memory vector", () => {
  it("bge-m3の1024次元だけを受け取り、異常値を拒否する", async () => {
    const vector = Array.from({ length: 1024 }, (_, index) => (index === 0 ? 1 : 0));
    const run = vi.fn().mockResolvedValue({ data: [vector] }) as unknown as Ai["run"];
    await expect(embedMemoryText({ run }, "紅茶が好きです。")).resolves.toEqual(vector);
    expect(run).toHaveBeenCalledWith("@cf/baai/bge-m3", {
      text: ["紅茶が好きです。"],
      truncate_inputs: false,
    });
    for (const invalid of [
      vector.slice(1),
      [...vector, 0],
      new Array(1024).fill(0),
      [Infinity, ...vector.slice(1)],
      [1e100, ...vector.slice(1)],
    ]) {
      expect(() => validateMemoryVector(invalid)).toThrow();
    }
  });

  it("同名でも利用者とキャラのIDで分かれ、版が違えばvector IDも変わる", async () => {
    const scope = { userId: "u", characterId: "c" };
    const namespace = await memoryNamespace(scope);
    expect(namespace).toHaveLength(64);
    expect(await memoryNamespace(scope)).toBe(namespace);
    expect(await memoryNamespace({ ...scope, userId: "other" })).not.toBe(namespace);
    expect(await memoryNamespace({ ...scope, characterId: "other" })).not.toBe(namespace);
    expect(await memoryVectorId("memory", "old")).not.toBe(await memoryVectorId("memory", "new"));
  });
});
