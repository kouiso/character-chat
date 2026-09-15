import { z } from "zod/v4";

export const HAIR_COLOR = [
  "black",
  "brown",
  "blonde",
  "silver",
  "white",
  "blue",
  "green",
  "purple",
  "red",
  "pink",
] as const;
export const HAIR_STYLE = [
  "straight",
  "wavy",
  "curly",
  "bob",
  "ponytail",
  "twintails",
  "braid",
  "messy",
] as const;
export const HAIR_LENGTH = ["short", "medium", "long", "very_long"] as const;
export const EYE_COLOR = [
  "black",
  "brown",
  "blue",
  "green",
  "hazel",
  "grey",
  "amber",
  "red",
  "heterochromia",
] as const;
export const SKIN_TONE = ["pale", "fair", "olive", "tanned", "dark"] as const;
export const BODY_TYPE = [
  "petite",
  "slender",
  "average",
  "athletic",
  "curvy",
  "voluptuous",
] as const;
export const BREAST_SIZE = ["flat", "small", "medium", "large", "huge"] as const;
export const HEIGHT_BAND = ["petite", "average", "tall"] as const;
export const UNDRESS_LEVEL = [
  "partial_top",
  "topless",
  "partial_bottom",
  "bottomless",
  "nude",
] as const;

export const visualMetaSchema = z.object({
  hairColor: z.enum(HAIR_COLOR),
  hairStyle: z.enum(HAIR_STYLE),
  hairLength: z.enum(HAIR_LENGTH),
  eyeColor: z.enum(EYE_COLOR),
  skinTone: z.enum(SKIN_TONE),
  bodyType: z.enum(BODY_TYPE),
  breastSize: z.enum(BREAST_SIZE).optional().nullable(),
  heightBand: z.enum(HEIGHT_BAND).optional().nullable(),
  ageApparent: z.number().int().min(15).max(80),
  distinctiveMarks: z.array(z.string().min(1).max(80)).max(20).default([]),
  defaultOutfit: z.array(z.string().min(1).max(80)).max(30).default([]),
  // Partial<Record<UNDRESS_LEVEL, string[]>> — 全レベルが揃っていなくてもよい
  undressProgression: z.record(z.string(), z.array(z.string().min(1).max(80)).max(20)).default({}),
});

export type VisualMeta = z.infer<typeof visualMetaSchema>;
