const DEFAULT_CONVERSATION_TITLE = "新しい会話";
const XML_TAG_PATTERN = /<[^>]+>/g;
const WHITESPACE_PATTERN = /\s+/g;
const IMAGE_PLACEHOLDER_STRINGS: ReadonlySet<string> = new Set([
  "画像を生成中",
  "画像を生成中...",
  "画像を生成中…",
]);

const isImagePlaceholder = (content: string): boolean =>
  IMAGE_PLACEHOLDER_STRINGS.has(content) ||
  (content.startsWith("画像を生成中... (") && content.endsWith(")")) ||
  (content.startsWith("画像を生成中… (") && content.endsWith(")"));

export const sanitizeConversationSnippet = (content: string, maxLength = 100): string | null => {
  const stripped = content.replace(XML_TAG_PATTERN, " ").replace(WHITESPACE_PATTERN, " ").trim();
  if (!stripped || isImagePlaceholder(stripped)) return null;
  return Array.from(stripped).slice(0, maxLength).join("");
};

export const buildConversationFallbackTitle = (
  content: string,
  preferredTitle?: string | null,
  maxLength = 30,
): string => {
  const preferred = preferredTitle?.trim();
  if (preferred) return Array.from(preferred).slice(0, 200).join("");
  return sanitizeConversationSnippet(content, maxLength) ?? "会話";
};

export const shouldReplaceDefaultConversationTitle = (title: string | null | undefined): boolean =>
  !title || title === DEFAULT_CONVERSATION_TITLE;

export { DEFAULT_CONVERSATION_TITLE };
