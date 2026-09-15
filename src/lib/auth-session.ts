import { createLogger } from "@/lib/logger";

const logger = createLogger("auth-session");

const AUTH_TOKEN_KEY = "auth_token";
export const AUTH_CHANGED_EVENT = "auth-token-changed";
// 期限まで 7 日以内なら事前更新する
const REFRESH_THRESHOLD_S = 7 * 24 * 60 * 60;

const parseJwtPayload = (token: string): Record<string, unknown> | null => {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1];
    if (!payload) return null;
    const padLength = (4 - (payload.length % 4)) % 4;
    const padded = payload
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(payload.length + padLength, "=");
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const isTokenFreshEnough = (token: string | null): boolean => {
  if (!token) return false;
  const payload = parseJwtPayload(token);
  const exp = typeof payload?.exp === "number" ? payload.exp : 0;
  return exp - Math.floor(Date.now() / 1000) > REFRESH_THRESHOLD_S;
};

const storeAuthToken = (token: string): void => {
  // Safari のプライベートブラウジングや容量超過で setItem は投げる。ここで投げると
  // 認証は通っとるのにログインが失敗し、起動時の取り直しも「セッション無し」に見える。
  // token の控えは Authorization ヘッダ用の写しであって、認証そのものは同時に張られる
  // HttpOnly cookie（同一オリジンの fetch へ自動で乗る）が持つ。控えを残せんかっただけで
  // ログインを落とさず、次の起動で取り直す。
  try {
    window.localStorage.setItem(AUTH_TOKEN_KEY, token);
  } catch {
    logger.warn(`localStorage.setItem("${AUTH_TOKEN_KEY}") failed`);
  }
  window.dispatchEvent(new CustomEvent(AUTH_CHANGED_EVENT));
};

const fetchAndStoreToken = async (): Promise<boolean> => {
  const res = await fetch("/api/auth/session", { method: "POST", credentials: "include" });
  if (!res.ok) return false;
  const body: unknown = await res.json();
  if (typeof body !== "object" || body === null || !("token" in body)) return false;
  const { token } = body as { token: unknown };
  if (typeof token === "string" && token) {
    storeAuthToken(token);
    return true;
  }
  return false;
};

export const getStoredAuthToken = (): string | null => {
  if (typeof window === "undefined") return null;
  const token = window.localStorage.getItem(AUTH_TOKEN_KEY)?.trim();
  return token || null;
};

export const ensureAuthToken = async (): Promise<boolean> => {
  if (typeof window === "undefined") return false;
  const stored = getStoredAuthToken();
  if (isTokenFreshEnough(stored)) return true;
  try {
    return await fetchAndStoreToken();
  } catch {
    // ネットワーク障害はサイレントに無視。次の API 呼び出しで 401 → credentials UI
    return false;
  }
};
