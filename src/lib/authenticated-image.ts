import { useEffect, useRef, useState } from "react";

import { apiFetch } from "@/lib/api";
import { AUTH_CHANGED_EVENT } from "@/lib/auth-session";
import { createLogger } from "@/lib/logger";

const logger = createLogger("authenticated-image");

// cookie/Basic はモバイルの <img> サブリクエストに乗らず本番で 401 になる。そのため同一オリジンの
// 保護画像は apiFetch(Bearer) で blob 取得して表示する。対象は /api/* と静的 /avatars/*
// （_middleware が app-JWT Bearer を受理する）。ここを通す画像はすべて cookie 挙動に非依存になる。
export const shouldAuthenticate = (url: string): boolean =>
  url.startsWith("/api/") || url.startsWith("/avatars/");

// 画像生成プロバイダ等、素の <img> 表示を許可する外部ホスト。CSP img-src とも整合させる。
const ALLOWED_IMAGE_HOSTS = new Set([
  "image.novita.ai",
  "novita.ai",
  "faas-output-image.s3.ap-southeast-1.amazonaws.com",
  "novita-output.s3.amazonaws.com",
  // Runware CDN（LoRA 推論経路の imageURL 配信ホスト）
  "im.runware.ai",
]);

// 表示してよい画像URLか。認証パス・data:/blob:・許可ホストのみ true。
export const isDisplayableImageUrl = (url: string): boolean => {
  if (shouldAuthenticate(url)) return true;
  if (url.startsWith("data:image/") || url.startsWith("blob:")) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && ALLOWED_IMAGE_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
};

// response.ok が false（401 等）を表す番兵。ネットワーク例外と区別してログ出力を分けるため。
class ImageResponseNotOkError extends Error {}

// 同一URLへ同時マウントした複数の <img> が apiFetch+blob を重複実行しないよう、URL 単位で
// Blob 取得 Promise を共有する。共有するのは Blob のみで、object URL は各コンシューマが個別に
// 生成・revoke する（単一の object URL を共有して revoke すると他コンシューマの表示が壊れる）。
// settle 後は成否に関わらず削除する（成功分を残すと閲覧済み Blob が無期限にメモリへ残るため）。
// 同時マウントの dedupe は in-flight の間だけ有効であれば十分。
const blobPromiseCache = new Map<string, Promise<Blob>>();

const loadImageBlob = (imageUrl: string): Promise<Blob> => {
  const cached = blobPromiseCache.get(imageUrl);
  if (cached) return cached;

  const promise = apiFetch(imageUrl)
    .then((response) => {
      if (!response.ok) throw new ImageResponseNotOkError(String(response.status));
      return response.blob();
    })
    .finally(() => {
      blobPromiseCache.delete(imageUrl);
    });

  blobPromiseCache.set(imageUrl, promise);
  return promise;
};

type AuthImageState = {
  source: string | null;
  url: string | null;
  failed: boolean;
};

// 認証が必要な画像URLを Bearer 付き blob (object URL) に解決する。非認証URLはそのまま返す。
export const useAuthenticatedImageUrl = (
  imageUrl: string | null,
): { url: string | null; failed: boolean } => {
  const [state, setState] = useState<AuthImageState>({
    source: null,
    url: null,
    failed: false,
  });
  const [retryTick, setRetryTick] = useState(0);
  const stateRef = useRef<AuthImageState>(state);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    stateRef.current = state;
  });

  useEffect(() => {
    if (!imageUrl || !shouldAuthenticate(imageUrl)) {
      // setState を effect 本体で直接呼ぶと cascading render を起こすため async IIFE に入れる。
      void (async () => {
        setState({ source: null, url: null, failed: false });
      })();
      return;
    }

    let active = true;
    void (async () => {
      setState({ source: null, url: null, failed: false });
      try {
        const blob = await loadImageBlob(imageUrl);
        if (!active) return;
        const objectUrl = URL.createObjectURL(blob);
        objectUrlRef.current = objectUrl;
        setState({ source: imageUrl, url: objectUrl, failed: false });
      } catch (error: unknown) {
        if (!(error instanceof ImageResponseNotOkError)) {
          logger.error("failed to load authenticated image", error);
        }
        if (active) setState({ source: imageUrl, url: null, failed: true });
      }
    })();

    return () => {
      active = false;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [imageUrl, retryTick]);

  useEffect(() => {
    const onAuthChanged = () => {
      const current = stateRef.current;
      if (current.source === imageUrl && current.failed) {
        setRetryTick((t) => t + 1);
      }
    };
    window.addEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
  }, [imageUrl]);

  if (!imageUrl || !shouldAuthenticate(imageUrl)) {
    return { url: imageUrl ?? "", failed: false };
  }

  return {
    url: state.source === imageUrl ? state.url : null,
    failed: state.source === imageUrl ? state.failed : false,
  };
};

// 表示に使う最終URLを返す。未解決・許可外の外部URL・認証blob未取得のいずれも null。
// resolved は resolveAvatarSrc 済みの値、authedUrl は useAuthenticatedImageUrl の blob URL。
export const pickDisplaySrc = (
  resolved: string | null,
  authedUrl: string | null,
): string | null => {
  if (!resolved) return null;
  if (shouldAuthenticate(resolved)) return authedUrl;
  return isDisplayableImageUrl(resolved) ? resolved : null;
};
