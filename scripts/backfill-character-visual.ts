import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  BODY_TYPE,
  BREAST_SIZE,
  EYE_COLOR,
  HAIR_COLOR,
  HAIR_LENGTH,
  HAIR_STYLE,
  HEIGHT_BAND,
  SKIN_TONE,
  UNDRESS_LEVEL,
  type VisualMeta,
  visualMetaSchema,
} from "../src/schema/character-visual-enums.ts";
import { OUTFIT_TAG_ENUM, sanitizeOutfitTags } from "../src/schema/outfit-tag.ts";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL = "openai/gpt-4o-mini";
const MANIFEST_PATH = ".work/backfill/visual-meta-manifest.json";
const RATE_LIMIT_MS = 2_000;
const WRANGLER_MAX_BUFFER = 64 * 1024 * 1024;
const UNDRESS_LEVEL_SET = new Set<string>(UNDRESS_LEVEL);
const HAIR_COLOR_SET = new Set<string>(HAIR_COLOR);
const HAIR_STYLE_SET = new Set<string>(HAIR_STYLE);
const HAIR_LENGTH_SET = new Set<string>(HAIR_LENGTH);
const EYE_COLOR_SET = new Set<string>(EYE_COLOR);
const SKIN_TONE_SET = new Set<string>(SKIN_TONE);
const BODY_TYPE_SET = new Set<string>(BODY_TYPE);
const BREAST_SIZE_SET = new Set<string>(BREAST_SIZE);
const HEIGHT_BAND_SET = new Set<string>(HEIGHT_BAND);

const HAIR_COLOR_ALIASES: Record<string, string> = {
  dark_brown: "brown",
  light_brown: "brown",
  gray: "silver",
  grey: "silver",
  silver_gray: "silver",
  silver_grey: "silver",
  platinum_blonde: "blonde",
};
const HAIR_STYLE_ALIASES: Record<string, string> = {
  bun: "straight",
  updo: "straight",
  hime_cut: "straight",
  half_up: "straight",
  loose_hair: "straight",
  long: "straight",
  long_hair: "straight",
  twin_tails: "twintails",
  twin_tail: "twintails",
  pigtails: "twintails",
};
const HAIR_LENGTH_ALIASES: Record<string, string> = {
  shoulder_length: "medium",
  waist_length: "long",
  floor_length: "very_long",
};
const EYE_COLOR_ALIASES: Record<string, string> = {
  aqua: "blue",
  cyan: "blue",
  violet: "blue",
  purple: "blue",
  blue_gray: "grey",
  blue_grey: "grey",
  gray: "grey",
  golden: "amber",
  gold: "amber",
  yellow: "amber",
  dark: "brown",
  sharp: "brown",
  gentle: "brown",
  big: "brown",
  wide: "brown",
  bright: "brown",
  soft: "brown",
};
const SKIN_TONE_ALIASES: Record<string, string> = {
  light: "fair",
  porcelain: "pale",
  tan: "tanned",
};
const BODY_TYPE_ALIASES: Record<string, string> = {
  slim: "slender",
  thin: "slender",
  mature: "curvy",
};

const SYSTEM_PROMPT = `You are a visual attribute extractor for anime/hentai character descriptions.
Given a character's visual_prompt and system_prompt, extract structured visual attributes.
Return ONLY valid JSON matching this schema exactly. Use null for unknown breast_size or height_band.
If text is in Japanese, understand it and map correctly.
For distinctiveMarks and undressProgression: use standard danbooru tags (English, lowercase, underscores).
For defaultOutfit: you MUST pick values from the allowed enum only. Never invent a new word; if the description mentions a garment that is not in the enum, pick the closest enum value or omit it.
For undressProgression: only include levels that are explicitly described; omit levels with no description.`;

const VISUAL_META_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "hairColor",
    "hairStyle",
    "hairLength",
    "eyeColor",
    "skinTone",
    "bodyType",
    "breastSize",
    "heightBand",
    "ageApparent",
    "distinctiveMarks",
    "defaultOutfit",
    "undressProgression",
  ],
  properties: {
    hairColor: { type: "string", enum: HAIR_COLOR },
    hairStyle: { type: "string", enum: HAIR_STYLE },
    hairLength: { type: "string", enum: HAIR_LENGTH },
    eyeColor: { type: "string", enum: EYE_COLOR },
    skinTone: { type: "string", enum: SKIN_TONE },
    bodyType: { type: "string", enum: BODY_TYPE },
    breastSize: { type: ["string", "null"], enum: [...BREAST_SIZE, null] },
    heightBand: { type: ["string", "null"], enum: [...HEIGHT_BAND, null] },
    ageApparent: { type: "integer", minimum: 18, maximum: 40 },
    distinctiveMarks: {
      type: "array",
      maxItems: 20,
      items: { type: "string", minLength: 1, maxLength: 80 },
    },
    // #923: 語彙を文章の指示やなく enum で縛る。string[] のままやと造語が通る。
    defaultOutfit: {
      type: "array",
      maxItems: 30,
      items: { type: "string", enum: OUTFIT_TAG_ENUM },
    },
    undressProgression: {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(
        UNDRESS_LEVEL.map((level) => [
          level,
          {
            type: "array",
            maxItems: 20,
            items: { type: "string", minLength: 1, maxLength: 80 },
          },
        ]),
      ),
    },
  },
};

type CharacterRow = {
  id: string;
  name: string;
  visualPrompt: string | null;
  imageMeta: unknown;
  systemPrompt: string;
};

type SourceSummary = {
  hasVisualPrompt: boolean;
  hasImageMeta: boolean;
  hasRelevantSystemPrompt: boolean;
};

type ManifestEntry =
  | {
      id: string;
      name: string;
      status: "success";
      source: SourceSummary;
      visualMeta: VisualMeta;
    }
  | {
      id: string;
      name: string;
      status: "failed";
      source: SourceSummary;
      error: string;
      rawResponse: string | null;
    }
  | {
      id: string;
      name: string;
      status: "skipped";
      source: SourceSummary;
      reason: string;
    };

type ValidationResult = { ok: true; data: VisualMeta } | { ok: false; message: string };

type CommandResult = {
  stdout: string;
  stderr: string;
};

type ResponseFormatMode = "json_schema" | "json_object";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseDevVars(): Map<string, string> {
  const text = readFileSync(".dev.vars", "utf8");
  const vars = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match === null) {
      continue;
    }

    const key = match[1];
    const rawValue = match[2].trim();
    const value =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
        ? rawValue.slice(1, -1)
        : rawValue;
    vars.set(key, value);
  }
  return vars;
}

function getOpenRouterApiKey(): string {
  const vars = parseDevVars();
  const key = vars.get("OPENROUTER_API_KEY");
  if (key === undefined || key.trim() === "") {
    throw new Error("OPENROUTER_API_KEY is missing in .dev.vars");
  }
  return key.trim();
}

function execFileText(file: string, args: readonly string[]): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(file, [...args], { maxBuffer: WRANGLER_MAX_BUFFER }, (error, stdout, stderr) => {
      const result = {
        stdout: String(stdout),
        stderr: String(stderr),
      };
      if (error !== null) {
        reject(
          new Error(
            `${file} ${args.join(" ")} failed: ${errorMessage(error)}\n${result.stderr}${result.stdout}`,
          ),
        );
        return;
      }
      resolve(result);
    });
  });
}

async function runWrangler(command: string): Promise<unknown> {
  const { stdout } = await execFileText("npx", [
    "wrangler",
    "d1",
    "execute",
    "DB",
    "--local",
    "--json",
    "--command",
    command,
  ]);
  return JSON.parse(stdout);
}

function wranglerResults(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error("Wrangler JSON response is not an array");
  }

  const first = value[0];
  if (!isRecord(first)) {
    throw new Error("Wrangler JSON response has no result object");
  }

  const results = first.results;
  if (!Array.isArray(results)) {
    throw new Error("Wrangler JSON response has no results array");
  }
  return results;
}

function parseCharacterRow(value: unknown): CharacterRow {
  if (!isRecord(value)) {
    throw new Error("Character row is not an object");
  }

  const id = value.id;
  const name = value.name;
  const visualPrompt = value.visual_prompt;
  const imageMeta = value.image_meta;
  const systemPrompt = value.system_prompt;

  if (typeof id !== "string") {
    throw new Error("Character row has invalid id");
  }
  if (typeof name !== "string") {
    throw new Error(`Character ${id} has invalid name`);
  }
  if (visualPrompt !== null && typeof visualPrompt !== "string") {
    throw new Error(`Character ${id} has invalid visual_prompt`);
  }
  if (typeof systemPrompt !== "string") {
    throw new Error(`Character ${id} has invalid system_prompt`);
  }

  return {
    id,
    name,
    visualPrompt,
    imageMeta,
    systemPrompt,
  };
}

async function readCharacters(): Promise<readonly CharacterRow[]> {
  const json = await runWrangler(
    "SELECT id, name, visual_prompt, image_meta, system_prompt FROM character ORDER BY created_at ASC",
  );
  return wranglerResults(json).map(parseCharacterRow);
}

function hasText(value: string | null): boolean {
  return value !== null && value.trim().length > 0;
}

function hasImageMeta(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed !== "null" && trimmed !== "{}";
  }
  if (isRecord(value)) {
    return Object.keys(value).length > 0;
  }
  return true;
}

function hasRelevantAppearanceInfo(text: string): boolean {
  return /hair|hairstyle|bangs|eyes?|skin|body|breast|height|outfit|uniform|dress|shirt|skirt|glasses|mole|tattoo|髪|黒髪|茶髪|金髪|銀髪|白髪|青髪|緑髪|紫髪|赤髪|ピンク髪|瞳|目|肌|体型|胸|身長|服|制服|ワンピース|シャツ|スカート|眼鏡|ほくろ|刺青/i.test(
    text,
  );
}

function sourceSummary(character: CharacterRow): SourceSummary {
  return {
    hasVisualPrompt: hasText(character.visualPrompt),
    hasImageMeta: hasImageMeta(character.imageMeta),
    hasRelevantSystemPrompt: hasRelevantAppearanceInfo(character.systemPrompt),
  };
}

function buildUserMessage(character: CharacterRow): string {
  return `Character name: ${character.name}
visual_prompt: ${hasText(character.visualPrompt) ? character.visualPrompt : "none"}
system_prompt excerpt (first 500 chars): ${character.systemPrompt.slice(0, 500)}

Required JSON keys and values:
{
  "hairColor": ${JSON.stringify(HAIR_COLOR)},
  "hairStyle": ${JSON.stringify(HAIR_STYLE)},
  "hairLength": ${JSON.stringify(HAIR_LENGTH)},
  "eyeColor": ${JSON.stringify(EYE_COLOR)},
  "skinTone": ${JSON.stringify(SKIN_TONE)},
  "bodyType": ${JSON.stringify(BODY_TYPE)},
  "breastSize": ${JSON.stringify([...BREAST_SIZE, null])},
  "heightBand": ${JSON.stringify([...HEIGHT_BAND, null])},
  "ageApparent": "integer from 18 to 40",
  "distinctiveMarks": "string[] danbooru tags",
  "defaultOutfit": "string[] chosen ONLY from the allowed enum declared in the response schema (${OUTFIT_TAG_ENUM.length} values). Never invent a word.",
  "undressProgression": "object with optional keys ${UNDRESS_LEVEL.join(", ")} and string[] danbooru tags"
}
Return exactly those camelCase top-level keys. Do not nest fields.
Never return null for hairColor, hairStyle, hairLength, eyeColor, skinTone, bodyType, or ageApparent.
If a required field is unknown, choose the closest allowed value; use these defaults only when necessary: hairStyle straight, eyeColor brown, skinTone fair, bodyType average, ageApparent 24.
Do not invent enum values like gentle, big, bun, long, blue_grey, or null for required fields.
For hairStyle, map bun/updo/hime_cut/loose_hair/long_hair to straight unless wavy, curly, bob, ponytail, twintails, braid, or messy is clearer.
For eyeColor, map blue grey/blue_gray to grey, golden/yellow to amber, and gentle/big/soft to brown.`;
}

function responseFormat(mode: ResponseFormatMode): Record<string, unknown> {
  if (mode === "json_schema") {
    return {
      type: "json_schema",
      json_schema: {
        name: "visual_meta",
        strict: false,
        schema: VISUAL_META_JSON_SCHEMA,
      },
    };
  }

  return { type: "json_object" };
}

function assistantContent(value: unknown): string {
  if (!isRecord(value)) {
    throw new Error("OpenRouter response is not an object");
  }

  const choices = value.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error("OpenRouter response has no choices");
  }

  const firstChoice = choices[0];
  if (!isRecord(firstChoice)) {
    throw new Error("OpenRouter choice is not an object");
  }

  const message = firstChoice.message;
  if (!isRecord(message)) {
    throw new Error("OpenRouter choice has no message");
  }

  const content = message.content;
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    const texts = content.flatMap((part) => {
      if (!isRecord(part)) {
        return [];
      }
      const text = part.text;
      return typeof text === "string" ? [text] : [];
    });
    if (texts.length > 0) {
      return texts.join("");
    }
  }

  throw new Error("OpenRouter message content is empty");
}

async function fetchOpenRouter(
  apiKey: string,
  character: CharacterRow,
  mode: ResponseFormatMode,
): Promise<string> {
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "adult-ai-app visual meta backfill",
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      temperature: 0,
      response_format: responseFormat(mode),
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserMessage(character) },
      ],
    }),
  });

  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`OpenRouter ${response.status}: ${bodyText}`);
  }

  return assistantContent(JSON.parse(bodyText));
}

async function extractVisualMeta(
  apiKey: string,
  character: CharacterRow,
): Promise<{ rawResponse: string; json: unknown }> {
  let lastError: string | null = null;
  const modes: readonly ResponseFormatMode[] = ["json_schema", "json_object"];
  for (const mode of modes) {
    try {
      const rawResponse = await fetchOpenRouter(apiKey, character, mode);
      return { rawResponse, json: JSON.parse(rawResponse) };
    } catch (error) {
      lastError = errorMessage(error);
      await delay(RATE_LIMIT_MS);
    }
  }

  throw new Error(lastError ?? "OpenRouter extraction failed");
}

function normalizedToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(/[\s-]+/g, "_");
}

function mapEnumValue(
  value: unknown,
  allowed: ReadonlySet<string>,
  aliases: Record<string, string>,
  fallback: string | null,
): unknown {
  if (typeof value !== "string") {
    return fallback ?? value;
  }

  const token = normalizedToken(value);
  if (allowed.has(token)) {
    return token;
  }

  const alias = aliases[token];
  return alias ?? fallback ?? value;
}

function normalizeNullableEnumValue(value: unknown, allowed: ReadonlySet<string>): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    return null;
  }

  const token = normalizedToken(value);
  return allowed.has(token) ? token : null;
}

function normalizeAge(value: unknown): unknown {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value !== "string") {
    return value;
  }

  const match = /\d+/.exec(value);
  if (match === null) {
    return value;
  }
  return Number(match[0]);
}

function normalizeVisualMetaCandidate(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  const normalized: Record<string, unknown> = { ...value };
  normalized.hairColor = mapEnumValue(
    normalized.hairColor,
    HAIR_COLOR_SET,
    HAIR_COLOR_ALIASES,
    "brown",
  );
  normalized.hairStyle = mapEnumValue(
    normalized.hairStyle,
    HAIR_STYLE_SET,
    HAIR_STYLE_ALIASES,
    "straight",
  );
  normalized.hairLength = mapEnumValue(
    normalized.hairLength,
    HAIR_LENGTH_SET,
    HAIR_LENGTH_ALIASES,
    "medium",
  );
  normalized.eyeColor = mapEnumValue(
    normalized.eyeColor,
    EYE_COLOR_SET,
    EYE_COLOR_ALIASES,
    "brown",
  );
  normalized.skinTone = mapEnumValue(normalized.skinTone, SKIN_TONE_SET, SKIN_TONE_ALIASES, "fair");
  normalized.bodyType = mapEnumValue(
    normalized.bodyType,
    BODY_TYPE_SET,
    BODY_TYPE_ALIASES,
    "average",
  );
  normalized.breastSize = normalizeNullableEnumValue(normalized.breastSize, BREAST_SIZE_SET);
  normalized.heightBand = normalizeNullableEnumValue(normalized.heightBand, HEIGHT_BAND_SET);
  normalized.ageApparent = normalizeAge(normalized.ageApparent);

  return normalized;
}

function validateVisualMeta(value: unknown): ValidationResult {
  const parsed = visualMetaSchema.safeParse(normalizeVisualMetaCandidate(value));
  if (!parsed.success) {
    return { ok: false, message: parsed.error.message };
  }

  if (parsed.data.ageApparent < 18 || parsed.data.ageApparent > 40) {
    return { ok: false, message: "ageApparent must be between 18 and 40" };
  }

  const invalidLevels = Object.keys(parsed.data.undressProgression).filter(
    (level) => !UNDRESS_LEVEL_SET.has(level),
  );
  if (invalidLevels.length > 0) {
    return {
      ok: false,
      message: `Invalid undressProgression levels: ${invalidLevels.join(", ")}`,
    };
  }

  return { ok: true, data: parsed.data };
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlNullable(value: string | null | undefined): string {
  return value === null || value === undefined ? "NULL" : sqlString(value);
}

function sqlNumber(value: number): string {
  return Number.isFinite(value) ? String(value) : "0";
}

function buildSqlStatements(characterId: string, visualMeta: VisualMeta): readonly string[] {
  const now = Date.now();
  const statements = [
    `INSERT INTO character_visual (character_id, hair_color, hair_style, hair_length, eye_color, skin_tone, body_type, breast_size, height_band, age_apparent, updated_at) VALUES (${sqlString(
      characterId,
    )}, ${sqlString(visualMeta.hairColor)}, ${sqlString(visualMeta.hairStyle)}, ${sqlString(
      visualMeta.hairLength,
    )}, ${sqlString(visualMeta.eyeColor)}, ${sqlString(visualMeta.skinTone)}, ${sqlString(
      visualMeta.bodyType,
    )}, ${sqlNullable(visualMeta.breastSize)}, ${sqlNullable(
      visualMeta.heightBand,
    )}, ${sqlNumber(visualMeta.ageApparent)}, ${sqlNumber(
      now,
    )}) ON CONFLICT(character_id) DO UPDATE SET hair_color = excluded.hair_color, hair_style = excluded.hair_style, hair_length = excluded.hair_length, eye_color = excluded.eye_color, skin_tone = excluded.skin_tone, body_type = excluded.body_type, breast_size = excluded.breast_size, height_band = excluded.height_band, age_apparent = excluded.age_apparent, updated_at = excluded.updated_at`,
    `DELETE FROM character_distinctive_mark WHERE character_id = ${sqlString(characterId)}`,
    `DELETE FROM character_default_outfit_tag WHERE character_id = ${sqlString(characterId)}`,
    `DELETE FROM character_undress_progression WHERE character_id = ${sqlString(characterId)}`,
  ];

  for (const tag of visualMeta.distinctiveMarks) {
    statements.push(
      `INSERT OR IGNORE INTO character_distinctive_mark (character_id, tag) VALUES (${sqlString(
        characterId,
      )}, ${sqlString(tag)})`,
    );
  }

  // #923: json_object モードでは enum が効かんので、書き込み直前でもう一度落とす。
  for (const [index, tag] of sanitizeOutfitTags(visualMeta.defaultOutfit).accepted.entries()) {
    statements.push(
      `INSERT OR IGNORE INTO character_default_outfit_tag (character_id, tag, weight, ord) VALUES (${sqlString(
        characterId,
      )}, ${sqlString(tag)}, 1.0, ${sqlNumber(index)})`,
    );
  }

  for (const [level, tags] of Object.entries(visualMeta.undressProgression)) {
    for (const tag of tags) {
      statements.push(
        `INSERT OR IGNORE INTO character_undress_progression (character_id, level, tag) VALUES (${sqlString(
          characterId,
        )}, ${sqlString(level)}, ${sqlString(tag)})`,
      );
    }
  }

  return statements;
}

function writeManifest(entries: readonly ManifestEntry[]): void {
  mkdirSync(dirname(MANIFEST_PATH), { recursive: true });
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(entries, null, 2)}\n`);
}

function countStatus(entries: readonly ManifestEntry[]): Record<string, number> {
  const counts: Record<string, number> = { success: 0, failed: 0, skipped: 0 };
  for (const entry of entries) {
    counts[entry.status] = (counts[entry.status] ?? 0) + 1;
  }
  return counts;
}

async function writeCharacterBatch(
  characterId: string,
  statements: readonly string[],
): Promise<void> {
  const command = `${statements.join(";\n")};`;
  await runWrangler(command);
  console.log(`DB write ${characterId}: ${statements.length} statements`);
}

async function processCharacter(apiKey: string, character: CharacterRow): Promise<ManifestEntry> {
  const source = sourceSummary(character);
  if (!source.hasVisualPrompt && !source.hasRelevantSystemPrompt) {
    return {
      id: character.id,
      name: character.name,
      status: "skipped",
      source,
      reason: "No visual_prompt or relevant appearance info in system_prompt",
    };
  }

  let rawResponse: string | null = null;
  try {
    const extracted = await extractVisualMeta(apiKey, character);
    rawResponse = extracted.rawResponse;
    const validated = validateVisualMeta(extracted.json);
    if (!validated.ok) {
      return {
        id: character.id,
        name: character.name,
        status: "failed",
        source,
        error: validated.message,
        rawResponse,
      };
    }

    return {
      id: character.id,
      name: character.name,
      status: "success",
      source,
      visualMeta: validated.data,
    };
  } catch (error) {
    return {
      id: character.id,
      name: character.name,
      status: "failed",
      source,
      error: errorMessage(error),
      rawResponse,
    };
  }
}

async function main(): Promise<void> {
  const apiKey = getOpenRouterApiKey();
  const characters = await readCharacters();
  const manifest: ManifestEntry[] = [];
  console.log(`Loaded ${characters.length} characters`);

  for (const [index, character] of characters.entries()) {
    const entry = await processCharacter(apiKey, character);
    manifest.push(entry);
    if (entry.status === "success") {
      const statements = buildSqlStatements(entry.id, entry.visualMeta);
      await writeCharacterBatch(entry.id, statements);
    }

    writeManifest(manifest);
    console.log(`${index + 1}/${characters.length} ${entry.status}: ${character.name}`);

    if (index < characters.length - 1) {
      await delay(RATE_LIMIT_MS);
    }
  }

  const counts = countStatus(manifest);
  console.log(
    `Summary: success=${counts.success ?? 0} failed=${counts.failed ?? 0} skipped=${
      counts.skipped ?? 0
    }`,
  );
}

main().catch((error: unknown) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
