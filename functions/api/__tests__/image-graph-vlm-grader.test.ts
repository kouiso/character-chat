import { describe, expect, it, vi } from "vitest";

import {
  createOpenRouterImageGrader,
  deriveVlmViolations,
  gradeGeneratedImage,
  parseVlmGradeContent,
  type VlmGradeRequest,
} from "../lib/image-graph/vlm-grader";

const baseRequest = (overrides: Partial<VlmGradeRequest> = {}): VlmGradeRequest => ({
  image: { kind: "url", url: "https://r2.example/generated.png" },
  characterVisual: {
    hairColor: "black",
    hairStyle: "long hair",
    eyeColor: "blue",
    skinTone: "fair",
    bodyType: "slim",
    outfitTags: ["sailor uniform"],
    undressProgressionTags: [],
  },
  sceneState: {
    locationId: "night-bus",
    locationTags: ["intercity overnight bus"],
    undressLevel: "partial_top",
    outfitId: null,
    matePresent: false,
  },
  ...overrides,
});

const okJsonResponse = (content: string) =>
  ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
  }) as unknown as Response;

describe("parseVlmGradeContent", () => {
  it("parses a plain JSON object and clamps scores to 0-100", () => {
    const scores = parseVlmGradeContent(
      '{"characterConsistency":150,"nsfwLevel":-5,"sceneFit":62,"notes":"close match"}',
    );
    expect(scores).toEqual({
      characterConsistency: 100,
      nsfwLevel: 0,
      sceneFit: 62,
      notes: "close match",
    });
  });

  it("extracts JSON from a fenced markdown block with surrounding prose", () => {
    const scores = parseVlmGradeContent(
      'Here is the grade:\n```json\n{"characterConsistency":80,"nsfwLevel":40,"sceneFit":75,"notes":"ok"}\n```\nDone.',
    );
    expect(scores?.characterConsistency).toBe(80);
    expect(scores?.sceneFit).toBe(75);
  });

  it("returns null for non-JSON content", () => {
    expect(parseVlmGradeContent("no json here")).toBeNull();
  });
});

describe("deriveVlmViolations", () => {
  it("flags low character consistency and low scene fit", () => {
    const violations = deriveVlmViolations(
      { characterConsistency: 40, nsfwLevel: 90, sceneFit: 30, notes: "" },
      { characterConsistency: 70, sceneFit: 60 },
    );
    expect(violations.map((v) => v.tag)).toEqual(["character_consistency", "scene_fit"]);
  });

  it("returns no violations when scores meet thresholds", () => {
    const violations = deriveVlmViolations(
      { characterConsistency: 85, nsfwLevel: 70, sceneFit: 80, notes: "" },
      { characterConsistency: 70, sceneFit: 60 },
    );
    expect(violations).toEqual([]);
  });
});

describe("gradeGeneratedImage", () => {
  it("calls OpenRouter with qwen VLM model and image_url content, returning parsed scores", async () => {
    const fetchImpl = vi.fn(async () =>
      okJsonResponse(
        '{"characterConsistency":88,"nsfwLevel":55,"sceneFit":72,"notes":"matches reference"}',
      ),
    );

    const result = await gradeGeneratedImage(baseRequest(), {
      apiKey: "test-key",
      appOrigin: "https://app.example",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("qwen/qwen-2.5-vl-72b-instruct");
    const userContent = body.messages[1].content;
    expect(userContent.some((part: { type: string }) => part.type === "image_url")).toBe(true);
    expect(
      userContent.find((part: { type: string }) => part.type === "image_url").image_url.url,
    ).toBe("https://r2.example/generated.png");

    expect(result.scores.characterConsistency).toBe(88);
    expect(result.scores.nsfwLevel).toBe(55);
    expect(result.violations).toEqual([]);
  });

  it("derives violations from low scores", async () => {
    const fetchImpl = vi.fn(async () =>
      okJsonResponse('{"characterConsistency":35,"nsfwLevel":10,"sceneFit":20,"notes":"off"}'),
    );

    const result = await gradeGeneratedImage(baseRequest(), {
      apiKey: "test-key",
      appOrigin: "https://app.example",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.violations.map((v) => v.tag)).toEqual(["character_consistency", "scene_fit"]);
  });

  it("builds a data URL for base64 image input", async () => {
    const fetchImpl = vi.fn(async () =>
      okJsonResponse('{"characterConsistency":90,"nsfwLevel":50,"sceneFit":80,"notes":""}'),
    );

    await gradeGeneratedImage(
      baseRequest({ image: { kind: "base64", data: "AAAA", mimeType: "image/jpeg" } }),
      {
        apiKey: "test-key",
        appOrigin: "https://app.example",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    );

    const body = JSON.parse(
      String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body),
    );
    const imagePart = body.messages[1].content.find(
      (part: { type: string }) => part.type === "image_url",
    );
    expect(imagePart.image_url.url).toBe("data:image/jpeg;base64,AAAA");
  });

  it("sends the canonical reference before the generated image for pixel comparison", async () => {
    const fetchImpl = vi.fn(async () =>
      okJsonResponse(
        '{"characterConsistency":92,"nsfwLevel":50,"sceneFit":80,"notes":"same person"}',
      ),
    );

    await gradeGeneratedImage(
      baseRequest({
        referenceImage: { kind: "base64", data: "/9j/REFERENCE" },
      }),
      {
        apiKey: "test-key",
        appOrigin: "https://app.example",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    );

    const body = JSON.parse(
      String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body),
    );
    const imageParts = body.messages[1].content.filter(
      (part: { type: string }) => part.type === "image_url",
    );
    expect(imageParts.map((part: { image_url: { url: string } }) => part.image_url.url)).toEqual([
      "data:image/jpeg;base64,/9j/REFERENCE",
      "https://r2.example/generated.png",
    ]);
    expect(body.messages[0].content).toContain("FIRST attached image");
  });

  it("returns empty (non-blocking) result on non-ok HTTP response", async () => {
    const fetchImpl = vi.fn(
      async () => ({ ok: false, status: 503, json: async () => ({}) }) as unknown as Response,
    );

    const result = await gradeGeneratedImage(baseRequest(), {
      apiKey: "test-key",
      appOrigin: "https://app.example",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.violations).toEqual([]);
    expect(result.scores.characterConsistency).toBe(0);
  });

  it("returns empty result when the VLM call throws", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });

    const result = await gradeGeneratedImage(baseRequest(), {
      apiKey: "test-key",
      appOrigin: "https://app.example",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.violations).toEqual([]);
  });
});

describe("createOpenRouterImageGrader", () => {
  it("wraps gradeGeneratedImage into the ImageGrader interface", async () => {
    const fetchImpl = vi.fn(async () =>
      okJsonResponse('{"characterConsistency":50,"nsfwLevel":60,"sceneFit":40,"notes":""}'),
    );
    const grader = createOpenRouterImageGrader({
      apiKey: "test-key",
      appOrigin: "https://app.example",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const outcome = await grader(baseRequest());
    expect(outcome.violations.map((v) => v.tag)).toEqual(["character_consistency", "scene_fit"]);
    expect(outcome.scores?.nsfwLevel).toBe(60);
  });
});
