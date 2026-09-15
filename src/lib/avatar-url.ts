const AVATAR_KEY_PATTERN = /(^|\/)[^/]+\.(?:avif|gif|jpe?g|png|webp)$/i;
const ABSOLUTE_OR_BROWSER_IMAGE_URL_PATTERN = /^(?:https?:\/\/|data:image\/|blob:)/i;

const encodeAvatarKey = (key: string): string =>
  key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

export const resolveAvatarSrc = (avatar: string | null | undefined): string | null => {
  const value = avatar?.trim();
  if (!value) return null;
  if (value.startsWith("/") || ABSOLUTE_OR_BROWSER_IMAGE_URL_PATTERN.test(value)) return value;
  if (value.includes("\0") || value.includes("..") || !AVATAR_KEY_PATTERN.test(value)) return null;
  return `/api/avatar/${encodeAvatarKey(value)}`;
};
