// 顔の絵を配るかの判定と実体の探索。
// 配るかは canServeAvatar の 1 か所だけが決める（一覧・検査の「見える」「公開済み」と同じ定義）。
// 実体の探す順: 同梱の絵 → R2 の avatars/<鍵> → R2 の <鍵>（旧アプリが置いた形）。
import { AVATAR_MEDIA_TYPES, normalizeType, sniffMediaType } from "./media";

export type AvatarEnv = {
  ASSETS: Pick<Fetcher, "fetch">;
  BUCKET: Pick<R2Bucket, "head" | "get">;
};

export type AvatarStatus = "unset" | "bundled" | "r2" | "missing" | "not_image" | "bad_key";

export type AvatarResolution =
  | { status: "unset" | "missing" | "not_image" | "bad_key" }
  | { status: "bundled" | "r2"; body: BodyInit | null; type: string };

// 配ってよい = 見える（名義が持ち主の集合に入る or 公式）または公開済み。
// 戻り値は配ってよい時の { avatar }、よくない時・行が無い時は null。
// 判定と avatar 列の取得を 1 問い合わせにまとめ、判定写しが別所に増えるのを防ぐ。
export const canServeAvatar = async (
  db: D1Database,
  characterId: string,
  owners: readonly string[],
): Promise<{ avatar: string | null } | null> => {
  const marks = owners.map(() => "?").join(", ");
  return db
    .prepare(
      `SELECT avatar FROM character WHERE id = ? AND (
        is_official = 1
        OR user_id IN (${marks})
        OR EXISTS (
          SELECT 1 FROM v2_character_publish p WHERE p.character_id = character.id
        )
      )`,
    )
    .bind(characterId, ...owners)
    .first<{ avatar: string | null }>();
};

// avatar 列の値 → 同梱・R2 で共通の鍵。DB にはファイル名形（char-akane.jpg）と
// パス形（/avatars/x.png）と旧アプリの R2 鍵（<利用者ID>/<UUID>.jpg）が混ざる。
// ..・末尾 /・NUL を含む値は、静的配信へ載せた時に別の資産を指しうるので鍵にしない。
export const avatarKey = (avatar: string): string | null => {
  const key = avatar.replace(/^\/+avatars\//, "").replace(/^\/+/, "");
  if (!key || key.includes("..") || key.endsWith("/") || key.includes("\0")) return null;
  return key;
};

// 鍵の各区画を encodeURIComponent して / で繋ぐ。<利用者ID>/<UUID>.jpg は
// /avatars/<利用者ID>/<UUID>.jpg として探す（パス全体の %2F 化は別名の資産になる）。
const encodeKeyPath = (key: string): string => key.split("/").map(encodeURIComponent).join("/");

type BundledHit = { response: Response; type: string };

const fetchBundled = async (
  env: AvatarEnv,
  requestUrl: string,
  key: string,
): Promise<BundledHit | null> => {
  const response = await env.ASSETS.fetch(
    new Request(new URL(`/avatars/${encodeKeyPath(key)}`, requestUrl)),
  );
  const type = normalizeType(response.headers.get("content-type") ?? undefined);
  // 静的配信は無いパスへ SPA の HTML を返しうるので、状態だけでなく型も見る。
  if (response.status === 200 && type.startsWith("image/")) return { response, type };
  await response.body?.cancel().catch(() => undefined);
  return null;
};

// check は状態だけ。名乗った型が画像でない（or 無い）時は先頭 12 バイトで判断する。
const resolveR2Check = async (
  env: AvatarEnv,
  key: string,
  metaType: string,
): Promise<AvatarResolution> => {
  if (AVATAR_MEDIA_TYPES.test(metaType)) return { status: "r2", body: null, type: metaType };
  const head12 = await env.BUCKET.get(key, { range: { offset: 0, length: 12 } });
  if (!head12) return { status: "missing" };
  const sniffed = sniffMediaType(new Uint8Array(await head12.arrayBuffer()));
  return sniffed?.startsWith("image/")
    ? { status: "r2", body: null, type: sniffed }
    : { status: "not_image" };
};

// serve は結局本体を返すので全部読む。
const resolveR2Serve = async (
  env: AvatarEnv,
  key: string,
  metaType: string,
): Promise<AvatarResolution> => {
  const object = await env.BUCKET.get(key);
  if (!object) return { status: "missing" };
  if (AVATAR_MEDIA_TYPES.test(metaType)) return { status: "r2", body: object.body, type: metaType };
  const bytes = new Uint8Array(await object.arrayBuffer());
  const sniffed = sniffMediaType(bytes.subarray(0, 12));
  if (!sniffed?.startsWith("image/")) return { status: "not_image" };
  return { status: "r2", body: bytes, type: sniffed };
};

const resolveR2 = (
  env: AvatarEnv,
  key: string,
  head: R2Object,
  mode: "serve" | "check",
): Promise<AvatarResolution> => {
  const metaType = normalizeType(head.httpMetadata?.contentType);
  return mode === "check" ? resolveR2Check(env, key, metaType) : resolveR2Serve(env, key, metaType);
};

// avatar 列の値から実体を引く。serve は本体を返し、check は状態だけを返す。
// R2 の呼び出しの例外はここで呑まず呼び出し側へ返す（「無い」と「読めなかった」を混ぜない）。
export const resolveAvatar = async (
  env: AvatarEnv,
  requestUrl: string,
  avatar: string | null,
  mode: "serve" | "check",
): Promise<AvatarResolution> => {
  if (!avatar) return { status: "unset" };
  const key = avatarKey(avatar);
  if (!key) return { status: "bad_key" };

  const bundled = await fetchBundled(env, requestUrl, key);
  if (bundled) {
    if (mode === "serve") {
      return { status: "bundled", body: bundled.response.body, type: bundled.type };
    }
    await bundled.response.body?.cancel().catch(() => undefined);
    return { status: "bundled", body: null, type: bundled.type };
  }

  // 1 バイト以下の物は実画像と扱わん（旧アプリの置き方と同じ）。
  for (const candidate of [`avatars/${key}`, key]) {
    const head = await env.BUCKET.head(candidate);
    if (head && head.size > 1) return resolveR2(env, candidate, head, mode);
  }
  return { status: "missing" };
};
