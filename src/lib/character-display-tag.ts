/**
 * 取り込み処理が記録用に付けた内部タグ。D1 には残すが画面には出さない。
 * 出典の記録であってキャラの気配ではないため、気配タグとして並ぶと意味を成さない（issue #920）。
 */
export const INTERNAL_CHARACTER_TAGS = ["imported", "charap"] as const;

const INTERNAL_TAG_SET = new Set<string>(INTERNAL_CHARACTER_TAGS);

const isInternalCharacterTag = (tag: string): boolean =>
  INTERNAL_TAG_SET.has(tag.trim().toLowerCase());

/** 画面に出してよいタグだけを残す。データ側は一切変更しない。 */
export const visibleCharacterTags = (tags: readonly string[] | null | undefined): string[] =>
  (tags ?? []).filter((tag) => !isInternalCharacterTag(tag));
