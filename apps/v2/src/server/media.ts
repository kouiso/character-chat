// 旧アプリ（functions/api/lib/route-context.ts）の R2_KEY_PATTERN に videos/*.mp4 を足した
// 上位互換。旧ファイルは Hono 等を引き込むので Worker からは読まず写し、旧キーが通らん
// ようになったら media.test.ts が落ちる。
// 旧 message.image_key は検証無しで D1 に残っとるので、画像・動画以外の R2 オブジェクトを
// 指す行を配信せん。videos/*.mp4 は RIT-190 で足した動画メディア。
export const R2_KEY_PATTERN =
  /^(images\/[\da-f-]+\.(jpg|png)|sub\/[\w-]+\/[\w.-]+\.(jpg|png)|videos\/[\da-f-]+\.mp4)$/;
const MEDIA_TYPES = /^image\/(png|jpeg|webp|gif|avif)$|^video\/mp4$/;
// 顔の絵は動画を配らんので image/ だけを許す（avatar.ts が同じ判定を使う）。
export const AVATAR_MEDIA_TYPES = /^image\/(png|jpeg|webp|gif|avif)$/;
// 旧アプリの ALLOWED_IMAGE_TYPES は送り元が名乗った image/jpg をそのまま保存しとる。
export const TYPE_ALIASES: Record<string, string> = { "image/jpg": "image/jpeg" };
// 型の無い・汎用型の実体は先頭のバイトで決める。拡張子を信用すると、画像の名前で置かれた
// HTML をメディア型で配ることになる。mp4 は先頭4バイトのサイズ後に "ftyp" が来る。
// prefix は 0 バイト目からの一致（WebP は "RIFF" で始まり 8 バイト目が "WEBP" の形だけ拾う）。
export const SIGNATURES: { type: string; bytes: number[]; offset?: number; prefix?: number[] }[] = [
  { type: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { type: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { type: "image/gif", bytes: [0x47, 0x49, 0x46, 0x38] },
  {
    type: "image/webp",
    prefix: [0x52, 0x49, 0x46, 0x46],
    bytes: [0x57, 0x45, 0x42, 0x50],
    offset: 8,
  },
  { type: "video/mp4", bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 },
];

export const normalizeType = (raw: string | undefined): string => {
  const type = (raw ?? "").split(";")[0].trim().toLowerCase();
  return TYPE_ALIASES[type] ?? type;
};

export const sniffMediaType = (head: Uint8Array): string | null =>
  SIGNATURES.find(
    ({ bytes, offset = 0, prefix }) =>
      (prefix ?? []).every((byte, index) => head[index] === byte) &&
      bytes.every((byte, index) => head[offset + index] === byte),
  )?.type ?? null;

const mediaResponse = (body: BodyInit, type: string): Response =>
  new Response(body, {
    headers: {
      "content-type": type,
      "x-content-type-options": "nosniff",
      // メディアの中身はメッセージID単位で不変。入口で共有キャッシュ化は防がれる前提の私用キャッシュ。
      "cache-control": "private, max-age=86400, immutable",
    },
  });

export const serveOwnedImage = async (
  key: string | null,
  bucket: Pick<R2Bucket, "get">,
): Promise<Response> => {
  if (!key || !R2_KEY_PATTERN.test(key)) return new Response(null, { status: 404 });
  const object = await bucket.get(key);
  if (!object) return new Response(null, { status: 404 });
  const type = normalizeType(object.httpMetadata?.contentType);
  if (MEDIA_TYPES.test(type)) return mediaResponse(object.body, type);
  // 旧アプリは型の無い画像も image/png として配っとったので、名乗りが無い時だけ中身を見る。
  if (type !== "" && type !== "application/octet-stream") {
    return new Response(null, { status: 415 });
  }
  const bytes = new Uint8Array(await object.arrayBuffer());
  const sniffed = sniffMediaType(bytes);
  if (!sniffed) return new Response(null, { status: 415 });
  return mediaResponse(bytes, sniffed);
};
