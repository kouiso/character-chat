export type CharacterImageMeta = {
  appearance: string;
  artStyle: string;
  outfit?: string;
  negativePrompt?: string;
};

export type ImageMetaAnchors = {
  positive: string;
  negative: string;
};

export const buildImageMetaAnchors = (imageMeta: CharacterImageMeta): ImageMetaAnchors => ({
  positive: [imageMeta.appearance, imageMeta.artStyle, imageMeta.outfit]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join(", "),
  negative: imageMeta.negativePrompt?.trim() ?? "",
});
