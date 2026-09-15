// HTTP Basic 認証の共通ロジック。_middleware.ts（サイト全体のゲート）と
// getUserEmail（/api の本人判定）が同一の検証を共有する。
// CF Access からの移行用: ブラウザは <img> や画面遷移を含む全リクエストへ Basic
// 資格情報を自動付与するため、モバイルで cookie がサブリクエストに乗らず画像や
// 会話履歴が出ない問題を解消できる。

export type BasicAuthEnv = {
  BASIC_AUTH_USER?: string;
  BASIC_AUTH_PASS?: string;
};

export const BASIC_AUTH_REALM = "adult-ai-chat";

// 両方揃って初めて有効。片方でも欠ければ未設定扱い。
export const isBasicAuthConfigured = (env: BasicAuthEnv): boolean =>
  Boolean(env.BASIC_AUTH_USER?.trim()) && Boolean(env.BASIC_AUTH_PASS);

// タイミング攻撃を避けるため、長さが違っても固定長で比較する。
const timingSafeEqual = (a: string, b: string): boolean => {
  const encoder = new TextEncoder();
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  const len = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i += 1) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
};

// Authorization ヘッダが設定済みの Basic 資格情報と一致するか検証する。
export const verifyBasicAuth = (
  authorization: string | undefined | null,
  env: BasicAuthEnv,
): boolean => {
  const expectedUser = env.BASIC_AUTH_USER?.trim();
  const expectedPass = env.BASIC_AUTH_PASS;
  if (!expectedUser || !expectedPass) return false;
  if (!authorization || !authorization.startsWith("Basic ")) return false;

  let decoded: string;
  try {
    decoded = atob(authorization.slice("Basic ".length).trim());
  } catch {
    return false;
  }
  const separator = decoded.indexOf(":");
  if (separator < 0) return false;

  const user = decoded.slice(0, separator);
  const pass = decoded.slice(separator + 1);
  // 早期 return せず両方評価して比較時間を一定に近づける。
  const userMatches = timingSafeEqual(user, expectedUser);
  const passMatches = timingSafeEqual(pass, expectedPass);
  return userMatches && passMatches;
};

// ブラウザに Basic 認証プロンプトを出させる 401 応答。
export const basicAuthChallenge = (): Response =>
  new Response("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Basic realm="${BASIC_AUTH_REALM}", charset="UTF-8"`,
      "Cache-Control": "no-store",
    },
  });
