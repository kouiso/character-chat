import type { CSSProperties, JSX, ReactNode } from "react";

import {
  pickDisplaySrc,
  shouldAuthenticate,
  useAuthenticatedImageUrl,
} from "@/lib/authenticated-image";
import { resolveAvatarSrc } from "@/lib/avatar-url";

interface AuthenticatedImageProps {
  src: string | null | undefined;
  alt?: string;
  className?: string;
  style?: CSSProperties;
  draggable?: boolean;
  loading?: "eager" | "lazy";
  fallback?: ReactNode;
  // 読み込み中に表示するプレースホルダー。未指定の場合は fallback と同じ。
  loadingFallback?: ReactNode;
  // 装飾用の背景アバター等で支援技術から隠すために使う（alt="" と併用）。
  "aria-hidden"?: boolean;
}

// 保護画像を Bearer 認証付きで読み込む共有 <img>。character.avatar / message.imageUrl / R2 キー等を
// resolveAvatarSrc で正規化し、/api・/avatars は blob 取得、許可された外部URL・data:/blob: は
// そのまま表示する。読み込み中は loadingFallback、未解決・認証フェッチ失敗時は fallback を返す。
export const AuthenticatedImage = ({
  src,
  fallback = null,
  loadingFallback = fallback,
  alt = "",
  ...imgProps
}: AuthenticatedImageProps): JSX.Element => {
  const resolved = resolveAvatarSrc(src);
  const { url, failed } = useAuthenticatedImageUrl(resolved);

  const displaySrc = pickDisplaySrc(resolved, url);
  const isAuth = resolved !== null && shouldAuthenticate(resolved);
  const isLoading = isAuth && displaySrc === null && !failed;
  if (isLoading) return <>{loadingFallback}</>;
  if (!displaySrc || failed) return <>{fallback}</>;

  return <img src={displaySrc} alt={alt} {...imgProps} />;
};
