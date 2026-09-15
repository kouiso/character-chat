import { describe, expect, it, vi } from "vitest";

import {
  decideVlmLikenessGate,
  readVlmLikenessGateContext,
  writeVlmLikenessGateContext,
  type VlmLikenessGateContext,
} from "../[[route]]";

const baseContext = (overrides: Partial<VlmLikenessGateContext> = {}): VlmLikenessGateContext => ({
  characterId: "char-1",
  novitaRequest: {
    model_name: "meinahentai_v4_70340.safetensors",
    prompt: "masterpiece, long black hair",
    negative_prompt: "low quality",
    width: 768,
    height: 1024,
    sampler_name: "DPM++ 2M Karras",
    steps: 32,
    guidance_scale: 7.5,
    image_num: 1,
    seed: -1,
    strength: 0.55,
  },
  phase: "intimate",
  attempt: 0,
  userId: "user-1",
  ...overrides,
});

const makeR2Bucket = () => {
  const values = new Map<string, string>();
  return {
    put: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    get: vi.fn(async (key: string) => {
      const value = values.get(key);
      if (!value) return null;
      return { text: async () => value };
    }),
    delete: vi.fn(async (key: string) => {
      values.delete(key);
    }),
  } as unknown as R2Bucket & {
    put: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
};

describe("VLM likeness gate context", () => {
  it("writes and reads task context from the expected R2 key", async () => {
    const bucket = makeR2Bucket();
    const context = baseContext();

    await writeVlmLikenessGateContext(bucket, "task-123", context);
    await expect(readVlmLikenessGateContext(bucket, "task-123")).resolves.toEqual(context);

    expect(bucket.put).toHaveBeenCalledWith(
      "image-gen-ctx/task-123.json",
      JSON.stringify(context),
      { httpMetadata: { contentType: "application/json" } },
    );
    expect(bucket.get).toHaveBeenCalledWith("image-gen-ctx/task-123.json");
  });
});

describe("decideVlmLikenessGate", () => {
  it("passes through when character consistency is above the conservative threshold", () => {
    const decision = decideVlmLikenessGate(baseContext(), {
      scores: { characterConsistency: 35, nsfwLevel: 60, sceneFit: 70, notes: "ok" },
      violations: [
        {
          tag: "character_consistency",
          issue: "below normal grader threshold",
          fix: "remove_tag",
        },
      ],
    });

    expect(decision).toEqual({ kind: "passthrough" });
  });

  it("regenerates once when character consistency is very low", () => {
    const decision = decideVlmLikenessGate(baseContext(), {
      scores: { characterConsistency: 12, nsfwLevel: 60, sceneFit: 70, notes: "different person" },
      violations: [
        {
          tag: "character_consistency",
          issue: "obvious mismatch",
          fix: "remove_tag",
        },
      ],
    });

    expect(decision.kind).toBe("regenerate");
  });

  it("fails open when VLM returned the non-blocking empty result", () => {
    const decision = decideVlmLikenessGate(baseContext(), {
      scores: { characterConsistency: 0, nsfwLevel: 0, sceneFit: 0, notes: "" },
      violations: [],
    });

    expect(decision).toEqual({ kind: "passthrough" });
  });

  it("passes through after the one-regeneration attempt cap", () => {
    const decision = decideVlmLikenessGate(baseContext({ attempt: 1 }), {
      scores: { characterConsistency: 8, nsfwLevel: 60, sceneFit: 70, notes: "different person" },
      violations: [
        {
          tag: "character_consistency",
          issue: "obvious mismatch",
          fix: "remove_tag",
        },
      ],
    });

    expect(decision).toEqual({ kind: "passthrough" });
  });
});
