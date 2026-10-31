// 旧アプリ（functions/api/lib/route-context.ts）の R2_KEY_PATTERN と同じ。旧ファイルは Hono 等を
// 引き込むので Worker からは読まず写し、ずれたら media.test.ts が落ちる。
// 旧 message.image_key は検証無しで D1 に残っとるので、画像以外の R2 オブジェクトを指す行を配信せん。
export const R2_KEY_PATTERN = /^(images\/[\da-f-]+\.(jpg|png)|sub\/[\w-]+\/[\w.-]+\.(jpg|png))$/;
const IMAGE_TYPE = /^image\/(png|jpeg|webp|gif|avif)$/;

export const serveOwnedImage = async (
  key: string | null,
  bucket: Pick<R2Bucket, "get">,
): Promise<Response> => {
  if (!key || !R2_KEY_PATTERN.test(key)) return new Response(null, { status: 404 });
  const object = await bucket.get(key);
  if (!object) return new Response(null, { status: 404 });
  const type = object.httpMetadata?.contentType;
  if (!type || !IMAGE_TYPE.test(type)) {
    return new Response(null, { status: 415 });
  }
  return new Response(object.body, {
    headers: { "content-type": type, "x-content-type-options": "nosniff" },
  });
};
