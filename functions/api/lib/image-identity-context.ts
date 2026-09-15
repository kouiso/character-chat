import {
  buildImageMetaAnchors,
  type CharacterImageMeta,
  type ImageMetaAnchors,
} from "./image-meta-anchor";

const NOVITA_SEED_UPPER_BOUND = 2_147_483_647;

type ResolveCharacterImageIdentityInput = {
  characterId: string;
  imageMeta: CharacterImageMeta | null;
  visualPrompt: string | null;
  requestedDescription: string;
  seed: number | null;
};

export type CharacterImageIdentity = {
  description: string;
  imageMetaAnchors: ImageMetaAnchors | null;
  hasAuthoritativeSource: boolean;
  seed: number;
};

export const deriveCharacterImageSeed = (characterId: string): number => {
  let hash = 2_166_136_261;
  for (let index = 0; index < characterId.length; index += 1) {
    hash ^= characterId.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return ((hash >>> 0) % (NOVITA_SEED_UPPER_BOUND - 1)) + 1;
};

export const resolveCharacterImageIdentity = (
  input: ResolveCharacterImageIdentityInput,
): CharacterImageIdentity => {
  const imageMetaAnchors = input.imageMeta ? buildImageMetaAnchors(input.imageMeta) : null;
  const approvedDescription = imageMetaAnchors?.positive.trim() ?? "";
  const requestedDescription = input.requestedDescription.trim();
  const visualPrompt = input.visualPrompt?.trim() ?? "";
  const seed =
    Number.isInteger(input.seed) &&
    input.seed !== null &&
    input.seed >= 0 &&
    input.seed < NOVITA_SEED_UPPER_BOUND
      ? input.seed
      : deriveCharacterImageSeed(input.characterId);

  return {
    description: approvedDescription || visualPrompt || requestedDescription,
    imageMetaAnchors: approvedDescription ? imageMetaAnchors : null,
    hasAuthoritativeSource: Boolean(approvedDescription || visualPrompt),
    seed,
  };
};

export const generateCharacterImageSeed = (): number => {
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  return (random[0] % (NOVITA_SEED_UPPER_BOUND - 1)) + 1;
};

export const generateCharacterImageRetrySeed = (previousSeed: number): number => {
  const candidate = generateCharacterImageSeed();
  return candidate === previousSeed ? (candidate % (NOVITA_SEED_UPPER_BOUND - 1)) + 1 : candidate;
};

export const buildIdentityImg2ImgRequest = <T extends { seed: number; strength?: number }>(
  request: T,
  imageBase64: string,
): T & { image_base64: string; strength: number } => ({
  ...request,
  image_base64: imageBase64,
  strength: request.strength ?? 0.55,
});

type ResolveCharacterReferenceInput = {
  highestOrdSubImageKey: string | null;
  avatarKey: string | null;
};

export type CharacterReferenceSource = {
  key: string;
  primaryLocation: "root" | "avatars";
};

export const resolveCharacterReferenceSource = (
  input: ResolveCharacterReferenceInput,
): CharacterReferenceSource | null => {
  const subImageKey = input.highestOrdSubImageKey?.trim() ?? "";
  if (subImageKey) return { key: subImageKey, primaryLocation: "root" };

  const avatarKey = input.avatarKey?.trim() ?? "";
  return avatarKey ? { key: avatarKey, primaryLocation: "avatars" } : null;
};
