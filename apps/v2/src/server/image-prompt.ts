// 会話起点の画像プロンプト組立（RIT-182）。キャラの外見と台帳の直近シーンを
// 英語 SD タグへ翻訳する。翻訳（OpenRouter）が落ちても生素材で続行し、生成自体は止めん。
import { z } from "zod";

export type ImagePromptEnv = {
  OPENROUTER_API_KEY?: string;
  V2_MODEL?: string;
  V2_OPENROUTER_BASE_URL?: string;
};

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const TRANSLATE_TIMEOUT_MS = 15_000;
const MAX_TAG_RUNES = 900;

// 台帳の全形を要求すると欠損で生成ごと死ぬ。シーンの素だけ寛容に拾う。
const sceneSourceSchema = z
  .object({
    location: z.string().nullable().optional(),
    time: z.string().nullable().optional(),
    position: z.string().nullable().optional(),
    clothing: z.record(z.string(), z.string()).optional(),
    lastEvents: z.array(z.string()).optional(),
  })
  .passthrough();

export type ImagePromptSource = {
  characterName: string;
  appearance: string;
  ledgerJson: string | null;
};

export const parseSceneSource = (ledgerJson: string | null): Record<string, unknown> | null => {
  if (!ledgerJson) return null;
  try {
    const parsed = sceneSourceSchema.safeParse(JSON.parse(ledgerJson));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

// 翻訳が使えん時の退避プロンプト。日本語素文は SD が読めんので、読める断片（英字・数字の語）だけ拾う。
const asciiWords = (text: string): string[] => text.match(/[A-Za-z][\w -]{1,30}/g) ?? [];

const fallbackTags = (source: ImagePromptSource): string =>
  asciiWords(`${source.appearance}\n${source.ledgerJson ?? ""}`)
    .map((word) => word.trim())
    .filter(Boolean)
    .slice(0, 60)
    .join(", ");

const SYSTEM =
  "You convert a character appearance and a scene summary into Stable Diffusion tags. " +
  "Output one line of comma-separated English booru-style tags only: character identity first " +
  "(hair, eyes, body, outfit), then scene (location, lighting, action, pose). " +
  "No sentences, no explanations, no numbers or weights.";

const responsesSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
});

const translate = async (env: ImagePromptEnv, material: string): Promise<string | null> => {
  if (!env.OPENROUTER_API_KEY) return null;
  const base = env.V2_OPENROUTER_BASE_URL?.replace(/\/+$/, "") || OPENROUTER_BASE;
  let response: Response;
  try {
    response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: env.V2_MODEL ?? "google/gemini-2.5-flash-lite",
        max_tokens: 300,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: material },
        ],
      }),
      signal: AbortSignal.timeout(TRANSLATE_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  try {
    const parsed = responsesSchema.safeParse(await response.json());
    if (!parsed.success) return null;
    const tags = parsed.data.choices[0].message.content
      .split("\n")[0]
      .replace(/^tags?:\s*/i, "")
      .trim();
    if (!tags) return null;
    return [...tags].slice(0, MAX_TAG_RUNES).join("");
  } catch {
    return null;
  }
};

export type BuiltImagePrompt = { prompt: string; degraded: boolean };

export const buildImagePrompt = async (
  env: ImagePromptEnv,
  source: ImagePromptSource,
): Promise<BuiltImagePrompt> => {
  const scene = parseSceneSource(source.ledgerJson);
  const material = [
    `Character: ${source.characterName}`,
    `Appearance: ${source.appearance || "(not specified)"}`,
    scene ? `Scene: ${JSON.stringify(scene)}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  const translated = await translate(env, material);
  if (translated) {
    return { prompt: `${translated}, masterpiece, best quality`, degraded: false };
  }
  const fallback = fallbackTags(source);
  return {
    prompt: `${fallback || "1girl, solo"}, masterpiece, best quality`,
    degraded: true,
  };
};

// 最小スライスの固定ネガティブ。v1 の位相別注入は後続チケットへ。
export const BASE_NEGATIVE_PROMPT = [
  "lowres",
  "bad anatomy",
  "bad hands",
  "missing fingers",
  "extra fingers",
  "worst quality",
  "low quality",
  "text",
  "watermark",
  "jpeg artifacts",
  "monochrome",
  "grayscale",
  "multiple girls",
  "2girls",
  "realistic",
  "photorealistic",
  "3d",
].join(", ");
