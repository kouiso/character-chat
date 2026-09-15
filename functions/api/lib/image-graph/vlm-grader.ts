import type { CharacterVisualSnapshot, EvalViolation, SceneStateSnapshot } from "./types";

// 生成済み画像をVLMで採点する。prompt-text 評価とは独立した「実画像」評価レイヤー。
const VLM_MODEL = "qwen/qwen-2.5-vl-72b-instruct";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 12_000;

// 0-100 スコアの足切り。下回ると violation を立てて再生成ループに戻す。
const DEFAULT_THRESHOLDS = {
  characterConsistency: 70,
  sceneFit: 60,
} as const;

export type VlmGraderThresholds = {
  // キャラ一致がこの値未満なら likeness 不足とみなす
  characterConsistency: number;
  // シーン適合がこの値未満なら scene-fit 不足とみなす
  sceneFit: number;
};

export type VlmGradeScores = {
  // 参照キャラとの見た目一致度 0-100
  characterConsistency: number;
  // NSFW 強度 0-100（高いほど露骨）。閾値判定はせずスコアのみ surface する
  nsfwLevel: number;
  // シーン文脈（場所・着衣段階）との適合度 0-100
  sceneFit: number;
  notes: string;
};

export type VlmGradeResult = {
  scores: VlmGradeScores;
  violations: EvalViolation[];
};

export type ImageInput =
  // R2 等のURL。OpenRouter にそのまま image_url として渡す
  | { kind: "url"; url: string }
  // base64（data URL でない生のbase64）。mimeType で data URL を組み立てる
  | { kind: "base64"; data: string; mimeType?: string };

export type VlmGradeRequest = {
  image: ImageInput;
  characterVisual: CharacterVisualSnapshot;
  sceneState: SceneStateSnapshot;
  // 参照キャラの自由記述（名前・特徴メモ等）。任意。
  characterReference?: string;
  // プロフィール等の正典画像。指定時は生成画像と画素を直接比較する。
  referenceImage?: ImageInput;
};

export type VlmGraderDeps = {
  apiKey: string;
  appOrigin: string;
  model?: string;
  timeoutMs?: number;
  thresholds?: Partial<VlmGraderThresholds>;
  // テスト・差し替え用。未指定なら global fetch。
  fetchImpl?: typeof fetch;
};

function toImageUrl(image: ImageInput): string {
  if (image.kind === "url") return image.url;
  // 既に data URL 形式なら二重化しない
  if (image.data.startsWith("data:")) return image.data;
  const inferredMimeType = image.data.startsWith("/9j/")
    ? "image/jpeg"
    : image.data.startsWith("UklGR")
      ? "image/webp"
      : image.data.startsWith("R0lGOD")
        ? "image/gif"
        : "image/png";
  return `data:${image.mimeType ?? inferredMimeType};base64,${image.data}`;
}

function describeCharacter(visual: CharacterVisualSnapshot, reference?: string): string {
  const traits = [
    visual.hairColor && `hair color: ${visual.hairColor}`,
    visual.hairStyle && `hair style: ${visual.hairStyle}`,
    visual.eyeColor && `eye color: ${visual.eyeColor}`,
    visual.skinTone && `skin tone: ${visual.skinTone}`,
    visual.bodyType && `body type: ${visual.bodyType}`,
    visual.outfitTags.length > 0 && `outfit: ${visual.outfitTags.join(", ")}`,
  ].filter((value): value is string => Boolean(value));
  const traitLine = traits.length > 0 ? traits.join("; ") : "no fixed visual traits provided";
  return reference ? `${reference}\nTraits: ${traitLine}` : `Traits: ${traitLine}`;
}

function describeScene(scene: SceneStateSnapshot): string {
  const parts = [
    scene.locationTags.length > 0 && `location: ${scene.locationTags.join(", ")}`,
    `undress level: ${scene.undressLevel}`,
    scene.matePresent ? "a partner is present" : "the character is alone",
  ].filter((value): value is string => Boolean(value));
  return parts.join("; ");
}

function buildGraderMessages(request: VlmGradeRequest): unknown[] {
  const hasReferenceImage = Boolean(request.referenceImage);
  const systemText =
    "You are a strict visual QA grader for AI-generated character images. " +
    (hasReferenceImage
      ? "The FIRST attached image is the canonical character reference. The SECOND attached image " +
        "is the generated scene. Compare the generated person against the reference pixels, " +
        "including hair, eyes, face shape, skin tone, and body type. "
      : "Compare the image against the reference character and scene context. ") +
    "Respond ONLY with a compact JSON object of the shape " +
    '{"characterConsistency":<0-100>,"nsfwLevel":<0-100>,"sceneFit":<0-100>,"notes":"<short>"}. ' +
    "characterConsistency = how well the depicted person matches the reference" +
    (hasReferenceImage ? " image" : " traits") +
    ". " +
    "nsfwLevel = explicitness of the image (0 fully clothed, 100 explicit). " +
    "sceneFit = how well the setting and undress level match the described scene. " +
    "No prose outside the JSON.";

  const userText = [
    "Reference character:",
    describeCharacter(request.characterVisual, request.characterReference),
    "",
    "Scene context:",
    describeScene(request.sceneState),
    "",
    hasReferenceImage
      ? "The first image is the reference. Grade the second image."
      : "Grade the attached image.",
  ].join("\n");

  const imageContent = request.referenceImage
    ? [
        { type: "image_url", image_url: { url: toImageUrl(request.referenceImage) } },
        { type: "image_url", image_url: { url: toImageUrl(request.image) } },
      ]
    : [{ type: "image_url", image_url: { url: toImageUrl(request.image) } }];

  return [
    { role: "system", content: systemText },
    {
      role: "user",
      content: [{ type: "text", text: userText }, ...imageContent],
    },
  ];
}

function clampScore(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function extractJsonObject(content: string): Record<string, unknown> | null {
  // ```json フェンスや前後の地の文を許容して最初のオブジェクトを拾う
  const fenced = content.match(/\{[\s\S]*\}/u);
  const raw = fenced?.[0] ?? content;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function parseVlmGradeContent(content: string): VlmGradeScores | null {
  const obj = extractJsonObject(content);
  if (!obj) return null;
  return {
    characterConsistency: clampScore(obj.characterConsistency),
    nsfwLevel: clampScore(obj.nsfwLevel),
    sceneFit: clampScore(obj.sceneFit),
    notes: typeof obj.notes === "string" ? obj.notes : "",
  };
}

export function deriveVlmViolations(
  scores: VlmGradeScores,
  thresholds: VlmGraderThresholds,
): EvalViolation[] {
  const violations: EvalViolation[] = [];
  if (scores.characterConsistency < thresholds.characterConsistency) {
    violations.push({
      tag: "character_consistency",
      issue: `Generated image character likeness scored ${scores.characterConsistency} (< ${thresholds.characterConsistency}).`,
      fix: "remove_tag",
    });
  }
  if (scores.sceneFit < thresholds.sceneFit) {
    violations.push({
      tag: "scene_fit",
      issue: `Generated image scene fit scored ${scores.sceneFit} (< ${thresholds.sceneFit}).`,
      fix: "remove_tag",
    });
  }
  return violations;
}

// OpenRouter chat completion の必要部分のみ。レート制限時は choices 不在の error body が返る。
type VlmChatCompletion = { choices?: Array<{ message?: { content?: string } }> };

// VLM 呼び出し失敗時に生成をブロックしないための空結果。
function emptyResult(): VlmGradeResult {
  return {
    scores: { characterConsistency: 0, nsfwLevel: 0, sceneFit: 0, notes: "" },
    violations: [],
  };
}

/**
 * 生成済み画像を qwen-2.5-vl-72b（OpenRouter 経由）で採点する。
 * VLM 呼び出しが失敗・タイムアウトした場合は生成をブロックしないため空 violations を返す。
 */
export async function gradeGeneratedImage(
  request: VlmGradeRequest,
  deps: VlmGraderDeps,
): Promise<VlmGradeResult> {
  const thresholds: VlmGraderThresholds = {
    ...DEFAULT_THRESHOLDS,
    ...deps.thresholds,
  };
  const fetchImpl = deps.fetchImpl ?? fetch;
  const abortController = new AbortController();
  const timeout = setTimeout(
    () => abortController.abort("vlm_grader_timeout"),
    deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  // OpenRouter の無検閲 VLM は共有枠で上流レート制限されやすく、HTTP 200 でも body に
  // error を返す（choices 不在）。status だけで判定すると毎回 fail-open=採点不発になるため、
  // choices の有無で成否を見て短いバックオフで最大3回まで再試行する。
  const maxTries = 3;
  try {
    let scores: VlmGradeScores | null = null;
    for (let tryIdx = 0; tryIdx < maxTries; tryIdx += 1) {
      const response = await fetchImpl(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${deps.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": deps.appOrigin,
          "X-Title": "Adult Fiction Image Grader",
        },
        body: JSON.stringify({
          model: deps.model ?? VLM_MODEL,
          messages: buildGraderMessages(request),
          stream: false,
          temperature: 0,
          max_tokens: 200,
          provider: { allow_fallbacks: true },
        }),
        signal: abortController.signal,
      });

      // rawJson を unknown で固定することで、build(Workers型=unknown)/eslint(DOM型=any) 双方で
      // 後続キャストが「必要」と判定され、tsconfig 差による lint/typecheck 衝突を避ける。
      const rawJson: unknown = response.ok ? await response.json() : null;
      const content = (rawJson as VlmChatCompletion | null)?.choices?.[0]?.message?.content ?? "";
      scores = content ? parseVlmGradeContent(content) : null;
      if (scores) break;

      if (tryIdx < maxTries - 1) {
        await new Promise((resolve) => setTimeout(resolve, 400 * (tryIdx + 1)));
      }
    }

    if (!scores) return emptyResult();

    return {
      scores,
      violations: deriveVlmViolations(scores, thresholds),
    };
  } catch {
    return emptyResult();
  } finally {
    clearTimeout(timeout);
  }
}

// evaluator から注入される画像グレーダーのインターフェース。
export type ImageGrader = (
  request: VlmGradeRequest,
) => Promise<{ violations: EvalViolation[]; scores?: VlmGradeScores }>;

// OpenRouter 実装を ImageGrader インターフェースに包む薄いファクトリ。
export function createOpenRouterImageGrader(deps: VlmGraderDeps): ImageGrader {
  return async (request) => {
    const result = await gradeGeneratedImage(request, deps);
    return { violations: result.violations, scores: result.scores };
  };
}
