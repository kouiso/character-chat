// アプリ JWT（HS256）の検証。_middleware.ts が静的資産の <img> サブリクエストに
// 付く Bearer を本人判定するために使う。画像の認証資格を Bearer に一本化する狙い。
// functions/api/[[route]].ts もこの共有実装を import して使う（重複実装は解消済み）。

const base64urlDecode = (str: string): ArrayBuffer => {
  const normalized = str.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized.padEnd(normalized.length + padLength, "=");
  const binary = atob(padded);
  const buf = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
};

const importHmacKey = (secret: string, usages: KeyUsage[]): Promise<CryptoKey> =>
  crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages,
  );

export const verifyAppJwt = async (
  authorization: string | undefined | null,
  signingKey: string | undefined,
): Promise<string | null> => {
  if (!authorization?.startsWith("Bearer ")) return null;
  if (!signingKey) return null;
  const token = authorization.slice(7).trim();
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  const signingInput = `${header}.${payload}`;
  try {
    const key = await importHmacKey(signingKey, ["verify"]);
    const signature = new Uint8Array(base64urlDecode(sig));
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      signature,
      new TextEncoder().encode(signingInput),
    );
    if (!valid) return null;
    // alg混同攻撃を防ぐためHS256を明示検証する（署名検証を通した攻撃者制御のヘッダを信用しない）。
    const decodedHeader: unknown = JSON.parse(new TextDecoder().decode(base64urlDecode(header)));
    if (typeof decodedHeader !== "object" || decodedHeader === null) return null;
    const { alg, typ } = decodedHeader as Record<string, unknown>;
    if (alg !== "HS256" || (typ !== undefined && typ !== "JWT")) return null;
    const decoded: unknown = JSON.parse(new TextDecoder().decode(base64urlDecode(payload)));
    if (typeof decoded !== "object" || decoded === null) return null;
    const { exp, email } = decoded as Record<string, unknown>;
    if (typeof exp !== "number" || exp < Math.floor(Date.now() / 1000)) return null;
    return typeof email === "string" ? email : null;
  } catch {
    return null;
  }
};
